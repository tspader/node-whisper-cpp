import { existsSync as exists, mkdirSync } from "node:fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { apt } from "./shell/apt";
import { command, sudo } from "./shell/common";
import { dpkg } from "./shell/dpkg";
import { github } from "./shell/github";
import { wget } from "./shell/wget";

const NVIDIA_REPO = "https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64";
const KEYRING_VERSION = "1.1-1";

function parse(version: string): { major: number; minor: number; patch: number } {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN))
    throw new Error(`invalid cuda version: ${version} (expected major.minor.patch)`);
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function pathsFor(version: string) {
  const { major, minor } = parse(version);
  return {
    pkg: `cuda-toolkit-${major}-${minor}`,
    cuda: `/usr/local/cuda-${major}.${minor}`,
    bin: `/usr/local/cuda-${major}.${minor}/bin`,
    lib: `/usr/local/cuda-${major}.${minor}/lib64`,
  };
}

async function emitPaths(version: string) {
  const paths = pathsFor(version);
  const owner = process.env.USER;

  try {
    mkdirSync(paths.cuda, { recursive: true });
  } catch {
    command(sudo(["mkdir", "-p", paths.cuda]));
  }

  if (owner) {
    command(sudo(["chown", "-R", `${owner}:${owner}`, paths.cuda]));
  }

  github()
    .output("path", paths.cuda)
    .output("bin", paths.bin)
    .output("lib", paths.lib)
    .output("pkg", paths.pkg);

  console.log(JSON.stringify(paths));
}

async function normalizeCachePermissions(version: string) {
  const paths = pathsFor(version);
  const owner = process.env.USER;
  if (owner) {
    command(sudo(["chown", "-R", `${owner}:${owner}`, paths.cuda]));
  }
}

async function install(version: string) {
  const base = pathsFor(version);

  const paths = {
    deb: `${NVIDIA_REPO}/cuda-keyring_${KEYRING_VERSION}_all.deb`,
    debFile: "/tmp/cuda-keyring.deb",
    pkg: base.pkg,
    cuda: base.cuda,
    bin: base.bin,
    lib: base.lib,
  };

  const nvccPath = `${paths.bin}/nvcc`;
  if (exists(nvccPath)) {
    console.log(`using cached ${paths.pkg} from ${paths.cuda}`);
  } else {
    console.log(`installing ${paths.pkg} from ${NVIDIA_REPO}`);

    // add nvidia apt repo
    await wget()
      .file(paths.debFile)
      .download(paths.deb);
    await dpkg().install(paths.debFile);
    await apt().update();

    // install toolkit (no driver -- CI has no GPU)
    await apt().batch(paths.pkg).install();
  }

  // export env for subsequent github actions steps
  if (process.env.GITHUB_ENV && process.env.GITHUB_PATH) {
    github()
      .export("CUDA_PATH", paths.cuda)
      .append("LD_LIBRARY_PATH", paths.lib)
      .path(paths.bin);
  }

  console.log(`cuda toolkit installed at ${paths.cuda}`);
}

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName("cuda")
    .command(
      "paths <cuda>",
      "Resolve canonical CUDA paths for CI",
      (cmd) =>
        cmd.positional("cuda", {
          type: "string",
          demandOption: true,
          desc: "CUDA version (major.minor.patch)",
        }),
      async (argv) => {
        await emitPaths(argv.cuda);
      },
    )
    .command(
      "normalize-cache-permissions <cuda>",
      "Normalize CUDA cache directory ownership",
      (cmd) =>
        cmd.positional("cuda", {
          type: "string",
          demandOption: true,
          desc: "CUDA version (major.minor.patch)",
        }),
      async (argv) => {
        await normalizeCachePermissions(argv.cuda);
      },
    )
    .command(
      "install <cuda>",
      "Install CUDA toolkit via apt (e.g. install 12.6.3)",
      (cmd) =>
        cmd.positional("cuda", {
          type: "string",
          demandOption: true,
          desc: "CUDA version (major.minor.patch)",
        }),
      async (argv) => {
        await install(argv.cuda);
      },
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}

if (import.meta.main) void main();
