import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const root = join(import.meta.dir, "..");
const npmDir = join(root, ".cache", "store", "npm");
const artifactsDir = join(root, "artifacts");

type Filter = "addon" | "js";

const JS_TARBALL = "node-whisper-cpp.tgz";

function matches(fileName: string, filter?: Filter): boolean {
  if (!filter) return true;
  if (filter === "js") return fileName === JS_TARBALL;
  return fileName.startsWith("node-whisper-cpp-") && fileName.endsWith(".tgz");
}

function stage(filter?: Filter) {
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
      } else if (entry.name.endsWith(".tgz") && matches(entry.name, filter)) {
        copyFileSync(join(dir, entry.name), join(artifactsDir, entry.name));
        console.log(`staged ${entry.name}`);
      }
    }
  }

  walk(npmDir);
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
