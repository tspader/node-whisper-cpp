import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { spinner } from "@clack/prompts";
import { describe, expect, it } from "bun:test";

import { Build } from "#tools/build";

type SmokeTarget = {
  triple: "mac-arm64-metal" | "linux-x64-cpu";
  platformPackage: "@node-whisper-cpp/mac-arm64-metal" | "@node-whisper-cpp/linux-x64-cpu";
};

const targetsBySystem: Record<string, SmokeTarget> = {
  "darwin-arm64": {
    triple: "mac-arm64-metal",
    platformPackage: "@node-whisper-cpp/mac-arm64-metal",
  },
  "linux-x64": {
    triple: "linux-x64-cpu",
    platformPackage: "@node-whisper-cpp/linux-x64-cpu",
  },
};

const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");

const repoRoot = join(import.meta.dir, "..");
const jsPackageDir = join(import.meta.dir, "packages", "js");
const tsPackageDir = join(import.meta.dir, "packages", "ts");
const jsTarballPath = join(repoRoot, ".cache", "store", "npm", "node-whisper-cpp.tgz");

function getTarget(): SmokeTarget | null {
  const key = `${process.platform}-${process.arch}`;
  return targetsBySystem[key] ?? null;
}

function nativeTarballPathFor(target: SmokeTarget): string {
  return join(repoRoot, ".cache", "store", "npm", "@node-whisper-cpp", `${target.triple}.tgz`);
}

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `cwd: ${cwd}`,
        `exit: ${result.status ?? -1}`,
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function resetPackageDir(packageDir: string) {
  rmSync(join(packageDir, "node_modules"), { recursive: true, force: true });
  rmSync(join(packageDir, "package-lock.json"), { force: true });
  rmSync(join(packageDir, "dist"), { recursive: true, force: true });
}

function assertInstalledPlatformPackage(packageDir: string, target: SmokeTarget) {
  const packageJsonPath = join(packageDir, "node_modules", ...target.platformPackage.split("/"), "package.json");
  expect(existsSync(packageJsonPath)).toBe(true);
}

describe("smoke", () => {
  it(
    "builds canonical tarballs and loads package in JS + TS consumers",
    async () => {
      const progress = spinner();
      const runPhase = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
        progress.start(label);
        try {
          const result = await fn();
          progress.stop(label);
          return result;
        } catch (error) {
          progress.stop(`${label} failed`);
          throw error;
        }
      };

      const target = getTarget();
      if (target == null) {
        console.warn(`Skipping smoke test for unsupported platform ${process.platform}-${process.arch}`);
        return;
      }

      const nativeTarballPath = nativeTarballPathFor(target);
      await runPhase("Ensuring tarballs", async () => {
        if (!existsSync(jsTarballPath) || !existsSync(nativeTarballPath)) {
          await Build.system();
        }

        expect(existsSync(jsTarballPath)).toBe(true);
        expect(existsSync(nativeTarballPath)).toBe(true);
      });

      resetPackageDir(jsPackageDir);
      try {
        await runPhase("Installing JS fixture", () => {
          run("npm", ["install"], jsPackageDir);
        });
        await runPhase("Running JS smoke", () => {
          assertInstalledPlatformPackage(jsPackageDir, target);
          const jsRun = run("node", ["./check.mjs"], jsPackageDir);
          expect(jsRun.stdout).toContain("smoke-js-ok");
        });
      } finally {
        resetPackageDir(jsPackageDir);
      }

      resetPackageDir(tsPackageDir);
      try {
        await runPhase("Installing TS fixture", () => {
          run("npm", ["install"], tsPackageDir);
        });
        await runPhase("Compiling TS fixture", () => {
          assertInstalledPlatformPackage(tsPackageDir, target);
          run("node", [tsc, "--project", "tsconfig.json"], tsPackageDir);
        });
        await runPhase("Running TS smoke", () => {
          const tsRun = run("node", ["./dist/check.js"], tsPackageDir);
          expect(tsRun.stdout).toContain("smoke-ts-ok");
        });
      } finally {
        resetPackageDir(tsPackageDir);
      }
    },
    1200000
  );
});
