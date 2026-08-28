import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { current } from "./version";

const root = join(import.meta.dir, "..");
const npmDir = join(root, ".cache", "store", "npm");
const artifactsDir = join(root, "artifacts");

type Filter = "addon" | "js";

function jsTarball(version: string): string {
  return `spader-node-whisper-cpp-${version}.tgz`;
}

function stage(filter?: Filter) {
  const version = current();
  const js = jsTarball(version);

  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });

  for (const entry of readdirSync(npmDir)) {
    if (!entry.endsWith(".tgz")) continue;

    const isJs = entry === js;
    if (filter === "js" && !isJs) continue;
    if (filter === "addon" && isJs) continue;

    copyFileSync(join(npmDir, entry), join(artifactsDir, entry));
    console.log(`staged ${entry}`);
  }
}

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName("stage")
    .command(
      "$0 [filter]",
      "Copy tarballs to artifacts/",
      (command) =>
        command.positional("filter", {
          type: "string",
          choices: ["addon", "js"] as const,
          desc: "Stage only addon or js tarballs (default: all)",
        }),
      (argv) => stage(argv.filter as Filter | undefined),
    )
    .strict()
    .help()
    .parseAsync();
}

if (import.meta.main) void main();
