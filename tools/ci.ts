import { join } from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { $ } from "bun";

const REPO = join(import.meta.dir, "..");

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName("release")
    .command(
      "build",
      "Build via GH workflow",
      (command) => command,
      async () => {
        await $
          `act workflow_dispatch -W .github/workflows/ci-linux.yml -j linux-build-smoke --container-architecture linux/amd64 -P ubuntu-22.04=ghcr.io/catthehacker/ubuntu:full-22.04`
          .cwd(REPO);
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
