import { copyFileSync, mkdirSync, existsSync as exists, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { $ } from "bun";

import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";

import { resolveTarget, getPlatformId } from "../packages/node-whisper-cpp/src/platform";
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
  JS_INSTALL: join(REPO, ".cache", "store", "js"),
  ADDON_BUILD: join(REPO, ".cache", "build", "node"),
  ADDON_PACKAGE_JSON: (target: Target) => join(REPO, "packages", "platform", getPlatformId(target), "package.json"),
  ADDON_TSCONFIG: (target: Target) => join(REPO, "packages", "platform", getPlatformId(target), "tsconfig.json"),
  source: join(REPO, ".cache", "source"),
  whisper: join(REPO, ".cache", "source", "whisper.cpp"),
  build: {
    dir: join(REPO, ".cache", "build"),
    whisper: (target: Target) => join(REPO, ".cache", "build", getPlatformId(target), "whisper"),
  },
  store: {
    addon: (target: Target) => join(REPO, ".cache", "store", "addon", getPlatformId(target)),
    whisper: (target: Target) => join(REPO, ".cache", "store", "whisper.cpp", getPlatformId(target)),
  },
  tarballs: join(REPO, ".cache", "store", "npm"),
};

async function packTarball(sourceDir: string, outputDir: string) {
  mkdirSync(outputDir, { recursive: true });
  await $`npm pack --pack-destination ${outputDir}`.cwd(sourceDir);
}

namespace Native {
  function cmakeFlags(os: Os) {
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

  interface CMakeConfig {
    source: string;
    buildDir: string;
    generator: string;
    buildType: string;
    prefix: string;
    defines: string[];
  }

  export interface CMakeChain {
    source(dir: string): CMakeChain;
    buildDir(dir: string): CMakeChain;
    generator(gen: string): CMakeChain;
    buildType(type: string): CMakeChain;
    prefix(dir: string): CMakeChain;
    define(key: string, value: string): CMakeChain;
    defineIf(key: string, value: string, pred: () => boolean): CMakeChain;
    defines(defs: string[]): CMakeChain;
    configure(): CMakeChain;
    build(): CMakeChain;
    install(): CMakeChain;
  }

  function run(args: string[]) {
    const result = Bun.spawnSync(["cmake", ...args], { cwd: REPO, stdio: ["inherit", "inherit", "inherit"] });
    if (!result.success) throw new Error(`cmake exited with code ${result.exitCode}`);
  }

  export function cmake(): CMakeChain {
    const config: CMakeConfig = {
      source: "",
      buildDir: "",
      generator: "",
      buildType: "Release",
      prefix: "",
      defines: [],
    };
    const chain: CMakeChain = {
      source(dir)          { config.source = dir; return chain; },
      buildDir(dir)        { config.buildDir = dir; return chain; },
      generator(gen)       { config.generator = gen; return chain; },
      buildType(type)      { config.buildType = type; return chain; },
      prefix(dir)          { config.prefix = dir; return chain; },
      define(key, value)   { config.defines.push(`-D${key}=${value}`); return chain; },
      defineIf(key, value, pred) { if (pred()) config.defines.push(`-D${key}=${value}`); return chain; },
      defines(defs)        { config.defines.push(...defs); return chain; },
      configure() {
        run([
          "-S", config.source,
          "-B", config.buildDir,
          ...(config.generator ? ["-G", config.generator] : []),
          `-DCMAKE_BUILD_TYPE=${config.buildType}`,
          ...(config.prefix ? [`-DCMAKE_INSTALL_PREFIX=${config.prefix}`] : []),
          ...config.defines,
        ]);
        return chain;
      },
      build() {
        run(["--build", config.buildDir, "--config", config.buildType]);
        return chain;
      },
      install() {
        run(["--install", config.buildDir, "--config", config.buildType]);
        return chain;
      },
    };
    return chain;
  }

  export async function build(target: Target, options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    if (!exists(dirs.whisper)) {
      await $`mkdir -p ${dirs.source}`.cwd(REPO);
      await $`git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git`.cwd(dirs.source);
    }

    cmake()
      .source(dirs.whisper)
      .buildDir(dirs.build.whisper(target))
      .generator("Ninja")
      .prefix(dirs.store.whisper(target))
      .define("BUILD_SHARED_LIBS", "ON")
      .define("WHISPER_BUILD_EXAMPLES", "OFF")
      .define("WHISPER_BUILD_TESTS", "OFF")
      .defineIf("GGML_CUDA", "ON", () => target.backend == "cuda")
      .defineIf("GGML_METAL", "ON", () => target.backend == "metal")
      .defineIf("GGML_VULKAN", "ON", () => target.backend == "vulkan")
      .defines(cmakeFlags(target.os))
      .configure()
      .build()
      .install();
  }

  export async function clean(options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    await $`rm -rf ${dirs.build.dir}`.cwd(REPO);
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
    await packTarball(dirs.store.addon(target), dirs.tarballs);
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
    await packTarball(dirs.JS_INSTALL, dirs.tarballs);
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
