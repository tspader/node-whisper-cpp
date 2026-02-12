import { copyFileSync, mkdirSync, existsSync as exists, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { $ } from "bun";

import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";

const REPO = join(import.meta.dir, "..");
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const cmakeJs = require.resolve("cmake-js/bin/cmake-js");

interface RunOptions {
  dryRun?: boolean;
}

type BuildTarget = {
  os: "mac" | "linux";
  arch: "arm64" | "x64";
  backend: "metal" | "cpu" | "cuda" | "vulkan";
};

const dirs = {
  REPO,
  CACHE: join(REPO, ".cache"),
  STORE: join(REPO, ".cache", "store"),
  TARBALLS: join(REPO, ".cache", "store", "npm"),
  JS_INSTALL: join(REPO, ".cache", "store", "js"),
  WHISPER_SOURCE: join(REPO, ".cache", "source", "whisper.cpp"),
  WHISPER_BUILD_ROOT: join(REPO, ".cache", "build"),
  WHISPER_BUILD: (target: string) => join(REPO, ".cache", "build", target, "whisper"),
  WHISPER_INSTALL: (target: string) => join(REPO, ".cache", "store", "whisper.cpp", target),
  ADDON_BUILD: join(REPO, ".cache", "build", "node"),
  ADDON_PACKAGE_JSON: (target: string) => join(REPO, "packages", "platform", target, "package.json"),
  ADDON_TSCONFIG: (target: string) => join(REPO, "packages", "platform", target, "tsconfig.json"),
  source: join(REPO, ".cache", "source"),
  store: {
    addon: (target: string) => join(REPO, ".cache", "store", "addon", target),
  }
};

function getTriple(os: string, arch: string, backend: string) {
  return `${os}-${arch}-${backend}`;
}

const buildTargetsBySystem: Record<string, BuildTarget> = {
  "darwin-arm64": {
    os: "mac",
    arch: "arm64",
    backend: "metal",
  },
  "linux-x64": {
    os: "linux",
    arch: "x64",
    backend: "cpu",
  },
};

function getSystemTarget(): BuildTarget {
  const key = `${process.platform}-${process.arch}`;
  const target = buildTargetsBySystem[key];
  if (target == null) {
    throw new Error(`Unsupported system target ${key}. Supported: ${Object.keys(buildTargetsBySystem).join(", ")}`);
  }

  return target;
}

function getJsTarballPath() {
  return join(dirs.TARBALLS, "@spader", "node-whisper-cpp.tgz");
}

function getNativeTarballPath(targetTriple: string) {
  return join(dirs.TARBALLS, "@spader", `node-whisper-cpp-${targetTriple}.tgz`);
}

async function packToCanonicalTarball(sourceDir: string, outputPath: string) {
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
  function getWhisperBackendFlags(backend: string) {
    if (backend === "metal") return ["-DGGML_METAL=ON"];
    if (backend === "cuda") return ["-DGGML_CUDA=ON"];
    if (backend === "vulkan") return ["-DGGML_VULKAN=ON"];
    return [];
  }

  export async function build(os: string, arch: string, backend: string, options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    const target = getTriple(os, arch, backend);
    if (!exists(dirs.WHISPER_SOURCE)) {
      await $`mkdir -p ${dirs.source}`.cwd(REPO);
      await $`git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git`.cwd(dirs.source);
    }

    await $
      `cmake -S ${dirs.WHISPER_SOURCE} -B ${dirs.WHISPER_BUILD(target)} -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=${dirs.WHISPER_INSTALL(target)} -DBUILD_SHARED_LIBS=ON -DWHISPER_BUILD_EXAMPLES=OFF -DWHISPER_BUILD_TESTS=OFF ${getWhisperBackendFlags(backend)}`
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
  const getCmakeTripleDefine = (target: string) => `--CDWHISPER_TRIPLE=${target}`;

  function materializeDylibAliases(target: string) {
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

  export async function build(os: string, arch: string, backend: string, options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    const target = getTriple(os, arch, backend);
    await $`node ${cmakeJs} compile --out ${dirs.ADDON_BUILD} ${getCmakeTripleDefine(target)}`.cwd(REPO);
    await $`rm -rf ${dirs.store.addon(target)}`.cwd(REPO);
    await $`mkdir -p ${dirs.store.addon(target)}`.cwd(REPO);
    await $`cmake --install ${dirs.ADDON_BUILD} --config Release --prefix ${join(dirs.store.addon(target), "bins")}`.cwd(REPO);
    materializeDylibAliases(target);
    await $`cp ${dirs.ADDON_PACKAGE_JSON(target)} ${join(dirs.store.addon(target), "package.json")}`.cwd(REPO);
    await $`node ${tsc} --project ${dirs.ADDON_TSCONFIG(target)} --outDir ${join(dirs.store.addon(target), "dist")}`.cwd(REPO);
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
    const optionalDependencies: Record<string, string> = {
      "@spader/node-whisper-cpp-mac-arm64-metal": version,
      "@spader/node-whisper-cpp-linux-x64-cpu": version,
    };
    const stagedPkg = {
      ...sourcePkg,
      optionalDependencies,
    };
    writeFileSync(targetPath, `${JSON.stringify(stagedPkg, null, 2)}\n`);

    await $`node ${tsc} --project tsconfig.json --outDir ${join(dirs.JS_INSTALL, "dist")}`.cwd(REPO);

  }
}

namespace Package {
  export async function build(os: string, arch: string, backend: string, options: RunOptions = {}) {
    if (options.dryRun) {
      return;
    }

    const triple = getTriple(os, arch, backend);
    await packToCanonicalTarball(dirs.JS_INSTALL, getJsTarballPath());
    await packToCanonicalTarball(dirs.store.addon(triple), getNativeTarballPath(triple));
  }
}

async function buildAll(os: string, arch: string, backend: string, options: RunOptions = {}) {
  await Native.build(os, arch, backend, options);
  await Addon.build(os, arch, backend, options);
  await Js.build(options);
  await Package.build(os, arch, backend, options);
}

export const Build = {
  async js(options: RunOptions = {}) {
    await Js.build(options);
  },

  async package(options: RunOptions = {}) {
    const { os, arch, backend } = getSystemTarget();
    await Package.build(os, arch, backend, options);
  },

  async system(options: RunOptions = {}) {
    const { os, arch, backend } = getSystemTarget();
    await buildAll(os, arch, backend, options);
  },
};

const options = (command: Argv) => {
  return command
    .option("os", { type: "string", demandOption: true })
    .option("arch", { type: "string", demandOption: true })
    .option("backend", { type: "string", demandOption: true });

}

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName("release")
    .command(
      "system",
      "Run native + addon + js + pack for current system",
      (command) => command,
      async () => {
        await Build.system();
      }
    )
    .command(
      "native",
      "Build whisper native libraries for a platform",
      options,
      async (argv) => {
        const { os, arch, backend } = argv;
        await Native.build(os, arch, backend);
      }
    )
    .command(
      "addon",
      "Build node addon for a platform",
      options,
      async (argv) => {
        const { os, arch, backend } = argv;
        await Native.build(os, arch, backend);
        await Addon.build(os, arch, backend);
      }
    )
    .command(
      "js",
      "Build TypeScript packages",
      (cmd) => cmd.option("all", { type: "boolean", default: false, desc: "Build all platform package TS outputs" }),
      async () => {
        await Js.build();
      }
    )
    .command(
      "pack",
      "Build package tarball",
      options,
      async (argv) => {
        const { os, arch, backend } = argv;
        await Package.build(os, arch, backend);
      }
    )
    .command(
      "all",
      "Run native + js + platform for current or selected platform",
      options,
      async (argv) => {
        const { os, arch, backend } = argv;
        await buildAll(os, arch, backend);
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
