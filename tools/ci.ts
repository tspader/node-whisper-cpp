import { join } from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { bump } from "./version";
import { install } from "./install";

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
