import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { bump } from "./version";
import { install } from "./install";
import { publish } from "./publish";
import { github } from "./shell/github";

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
          github().output("version", version);
        }
      }
    )
    .command(
      "publish",
      "Publish tarballs from artifacts/ (platform packages first, then JS)",
      (command) => command,
      async () => await publish(),
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}

if (import.meta.main) void main();
