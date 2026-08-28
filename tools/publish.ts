import { readdirSync } from "node:fs";
import { join } from "node:path";

import { $ } from "bun";

import { current } from "./version";

const root = join(import.meta.dir, "..");
const artifactsDir = join(root, "artifacts");

function jsTarball(version: string): string {
  return `spader-node-whisper-cpp-${version}.tgz`;
}

export async function publish() {
  const version = current();
  const js = jsTarball(version);
  const files = readdirSync(artifactsDir).filter((f) => f.endsWith(".tgz"));

  const platform: string[] = [];
  let jsPath: string | undefined;

  for (const file of files) {
    if (file === js) {
      jsPath = join(artifactsDir, file);
    } else {
      platform.push(join(artifactsDir, file));
    }
  }

  if (platform.length === 0 && !jsPath) {
    throw new Error(`No tarballs found in ${artifactsDir}`);
  }

  for (const tgz of platform) {
    console.log(`publishing ${tgz}`);
    await $`npm publish ${tgz} --access public`;
  }

  if (jsPath) {
    console.log(`publishing ${jsPath}`);
    await $`npm publish ${jsPath} --access public`;
  }
}
