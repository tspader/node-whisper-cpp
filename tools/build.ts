import { copyFileSync, mkdirSync, existsSync as exists, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { $ } from "bun";

import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";

import { resolveTarget, getPlatformId, getPackageName } from "../packages/node-whisper-cpp/src/platform";
import type { Target, Backend, Os } from "../packages/node-whisper-cpp/src/platform";

const REPO = join(import.meta.dir, "..");
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const cmakeJs = require.resolve("cmake-js/bin/cmake-js");

interface RunOptions {
  dryRun?: boolean;
}

const dirs = {
  REPO,
  CACHE: join(REPO, ".cache"),
  STORE: join(REPO, ".cache", "store"),
  TARBALLS: join(REPO, ".cache", "store", "npm"),
  JS_INSTALL: join(REPO, ".cache", "store", "js"),
  WHISPER_SOURCE: join(REPO, ".cache", "source", "whisper.cpp"),
  WHISPER_BUILD_ROOT: join(REPO, ".cache", "build"),
  WHISPER_BUILD: (target: Target) => join(REPO, ".cache", "build", getPlatformId(target), "whisper"),
  WHISPER_INSTALL: (target: Target) => join(REPO, ".cache", "store", "whisper.cpp", getPlatformId(target)),
  ADDON_BUILD: join(REPO, ".cache", "build", "node"),
  ADDON_PACKAGE_JSON: (target: Target) => join(REPO, "packages", "platform", getPlatformId(target), "package.json"),
  ADDON_TSCONFIG: (target: Target) => join(REPO, "packages", "platform", getPlatformId(target), "tsconfig.json"),
  source: join(REPO, ".cache", "source"),
  store: {
    addon: (target: Target) => join(REPO, ".cache", "store", "addon", getPlatformId(target)),
  },
  tarballs: {
    addon: (target: Target) => join(REPO, ".cache", "store", "npm", "@spader", `${getPackageName(target)}.tgz`),
    js: join(REPO, ".cache", "store", "npm", "@spader", "node-whisper-cpp.tgz"),
  },
};

async function packTarball(sourceDir: string, outputPath: string) {
  const outputDir = dirname(outputPath);
  const stagingDir = join(outputDir, ".staging");

  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  await $`npm pack --pack-destination ${stagingDir}`.cwd(sourceDir);

  const tarballs = readdirSync(stagingDir).filter((fileName) => fileName.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one tarball from npm pack in ${stagingDir}, found ${tarballs.length}`);
  }

  mkdirSync(outputDir, { recursive: true });
  rmSync(outputPath, { force: true });
  copyFileSync(join(stagingDir, tarballs[0]), outputPath);
  rmSync(stagingDir, { recursive: true, force: true });
}

namespace Native {
  function getWhisperBackendFlags(backend: Backend) {
    if (backend === "metal") return ["-DGGML_METAL=ON"];
    if (backend === "cuda") return ["-DGGML_CUDA=ON"];
    if (backend === "vulkan") return ["-DGGML_VULKAN=ON"];
    return [];
  }

  function getWhisperRuntimeFlags(os: Os) {
    const common = ["-DCMAKE_PLATFORM_NO_VERSIONED_SONAME=ON"];
    if (os !== "linux") {
      return common;
    }

    return [
      ...common,
      "-DCMAKE_SKIP_BUILD_RPATH=FALSE",
      "-DCMAKE_INSTALL_RPATH_USE_LINK_PATH=FALSE",
      "-DCMAKE_BUILD_RPATH=$ORIGIN",
      "-DCMAKE_INSTALL_RPATH=$ORIGIN",
    ];
  }

  export async function build(target: Target, options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    if (!exists(dirs.WHISPER_SOURCE)) {
      await $`mkdir -p ${dirs.source}`.cwd(REPO);
      await $`git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git`.cwd(dirs.source);
    }

    await $
      `cmake -S ${dirs.WHISPER_SOURCE} -B ${dirs.WHISPER_BUILD(target)} -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=${dirs.WHISPER_INSTALL(target)} -DBUILD_SHARED_LIBS=ON -DWHISPER_BUILD_EXAMPLES=OFF -DWHISPER_BUILD_TESTS=OFF ${getWhisperBackendFlags(target.backend)} ${getWhisperRuntimeFlags(target.os)}`
      .cwd(REPO);
    await $`cmake --build ${dirs.WHISPER_BUILD(target)} --config Release`.cwd(REPO);
    await $`cmake --install ${dirs.WHISPER_BUILD(target)} --config Release`.cwd(REPO);
  }

  export async function clean(options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    await $`rm -rf ${dirs.WHISPER_BUILD_ROOT}`.cwd(REPO);
  }
}

namespace Addon {
  const getCmakeTripleDefine = (target: Target) => `--CDWHISPER_TRIPLE=${getPlatformId(target)}`;

  function materializeDylibAliases(target: Target) {
    const binsDir = join(dirs.store.addon(target), "bins");
    if (!exists(binsDir)) {
      return;
    }

    for (const fileName of readdirSync(binsDir)) {
      const match = fileName.match(/^(lib.+)\.(\d+)\.(\d+)\.(\d+)\.dylib$/);
      if (!match) {
        continue;
      }

      const baseName = match[1];
      const majorName = `${baseName}.${match[2]}.dylib`;
      const plainName = `${baseName}.dylib`;
      const sourcePath = join(binsDir, fileName);
      const majorPath = join(binsDir, majorName);
      const plainPath = join(binsDir, plainName);

      rmSync(majorPath, { force: true });
      copyFileSync(sourcePath, majorPath);

      rmSync(plainPath, { force: true });
      copyFileSync(sourcePath, plainPath);
    }
  }

  export async function build(target: Target, options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    await $`node ${cmakeJs} compile --out ${dirs.ADDON_BUILD} ${getCmakeTripleDefine(target)}`.cwd(REPO);
    await $`rm -rf ${dirs.store.addon(target)}`.cwd(REPO);
    await $`mkdir -p ${dirs.store.addon(target)}`.cwd(REPO);
    await $`cmake --install ${dirs.ADDON_BUILD} --config Release --prefix ${join(dirs.store.addon(target), "bins")}`.cwd(REPO);
    materializeDylibAliases(target);
    const addonPkg = JSON.parse(readFileSync(dirs.ADDON_PACKAGE_JSON(target), "utf8"));
    addonPkg.version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
    writeFileSync(join(dirs.store.addon(target), "package.json"), `${JSON.stringify(addonPkg, null, 2)}\n`);
    await $`node ${tsc} --project ${dirs.ADDON_TSCONFIG(target)} --outDir ${join(dirs.store.addon(target), "dist")}`.cwd(REPO);
  }

  export async function pack(target: Target) {
    await packTarball(dirs.store.addon(target), dirs.tarballs.addon(target));
  }

  export async function clean(options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    await $`node ${cmakeJs} clean --out ${dirs.ADDON_BUILD}`.cwd(REPO);
  }
}

namespace Js {
  export async function build(options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    await $`rm -rf ${dirs.JS_INSTALL}`.cwd(REPO);
    await $`mkdir -p ${join(dirs.JS_INSTALL, "dist")}`.cwd(REPO);

    const sourcePath = join(REPO, "package.json");
    const targetPath = join(dirs.JS_INSTALL, "package.json");
    const sourcePkg = JSON.parse(readFileSync(sourcePath, "utf8")) as {
      version: string;
      optionalDependencies?: Record<string, string>;
    };
    const version = sourcePkg.version;
    const optionalDependencies: Record<string, string> = {};
    for (const key of Object.keys(sourcePkg.optionalDependencies ?? {})) {
      optionalDependencies[key] = version;
    }
    const stagedPkg = {
      ...sourcePkg,
      optionalDependencies,
    };
    writeFileSync(targetPath, `${JSON.stringify(stagedPkg, null, 2)}\n`);

    await $`node ${tsc} --project tsconfig.json --outDir ${join(dirs.JS_INSTALL, "dist")}`.cwd(REPO);
  }

  export async function pack() {
    await packTarball(dirs.JS_INSTALL, dirs.tarballs.js);
  }
}

export const Build = {
  async js(options: RunOptions = {}) {
    await Js.build(options);
    await Js.pack();
  },
};

const backendOption = (command: Argv) => {
  return command
    .option("backend", { type: "string", choices: ["metal", "cpu", "cuda", "vulkan"] as const });
};

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName("release")
    .command(
      "native",
      "Build whisper native libraries",
      backendOption,
      async (argv) => {
        const target = resolveTarget(argv.backend as Backend | undefined);
        await Native.build(target);
      }
    )
    .command(
      "addon",
      "Build node addon",
      backendOption,
      async (argv) => {
        const target = resolveTarget(argv.backend as Backend | undefined);
        await Native.build(target);
        await Addon.build(target);
        await Addon.pack(target);
      }
    )
    .command(
      "js",
      "Build TypeScript packages",
      (cmd) => cmd,
      async () => {
        await Js.build();
        await Js.pack();
      }
    )
    .command(
      "all",
      "Run native + addon + js + pack",
      backendOption,
      async (argv) => {
        const target = resolveTarget(argv.backend as Backend | undefined);
        await Native.build(target);
        await Addon.build(target);
        await Js.build();
        await Addon.pack(target);
        await Js.pack();
      }
    )
    .command(
      "clean",
      "Clean native and addon build outputs",
      (command) => command,
      async () => {
        await Native.clean();
        await Addon.clean();
      }
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}

if (import.meta.main) {
  void main();
}
