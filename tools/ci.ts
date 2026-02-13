import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { bump } from "./version";
import { install } from "./install";

const root = join(import.meta.dir, "..");
const npmDir = join(root, ".cache", "store", "npm");
const artifactsDir = join(root, "artifacts");

function stage() {
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });

  // copy every .tgz under .cache/store/npm (recurses into @spader/)
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
      } else if (entry.name.endsWith(".tgz")) {
        copyFileSync(join(dir, entry.name), join(artifactsDir, entry.name));
        console.log(`staged ${entry.name}`);
      }
    }
  }

  walk(npmDir);
}

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName("ci")
    .command(
      "install",
      "Install Linux CI dependencies locally",
      (command) => command,
      async () => await install(),
    )
    .command(
      "stage",
      "Copy tarballs to artifacts/",
      (command) => command,
      () => stage(),
    )
    .command(
      "version <bump>",
      "Bump version across all package.json files",
      (command) =>
        command.positional("bump", {
          type: "string",
          desc: "major, minor, patch, or an explicit version string",
          demandOption: true,
        }),
      async (argv) => {
        const version = await bump(argv.bump as string);
        console.log(`version: ${version}`);
        if (process.env.GITHUB_OUTPUT) {
          await Bun.file(process.env.GITHUB_OUTPUT).writer().write(`version=${version}\n`);
        }
      }
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}

if (import.meta.main) void main();
