import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const binsDir = join(packageRoot, "bins");
const packageVersion: string = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8")
).version;

export function getBinsDir() {
  return {
    binsDir,
    packageVersion,
  };
}
