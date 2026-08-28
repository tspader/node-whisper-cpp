import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

const paths = [
  ".cache",
  "build",
  "dist",
  "artifacts",
  "test/.tmp",
];

// packages/platform/*/dist and packages/platform/*/bins
const platformDir = join(root, "packages", "platform");
if (existsSync(platformDir)) {
  for (const name of readdirSync(platformDir)) {
    paths.push(`packages/platform/${name}/dist`);
    paths.push(`packages/platform/${name}/bins`);
  }
}

for (const rel of paths) {
  const abs = join(root, rel);
  if (existsSync(abs)) {
    rmSync(abs, { recursive: true, force: true });
    console.log(`removed ${rel}`);
  }
}

console.log("clean ok");
