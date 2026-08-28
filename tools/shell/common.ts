import { existsSync } from "node:fs";
import { join } from "node:path";

import { exec } from "@actions/exec";

const dir = join(import.meta.dir, "..", "..");

const root = () => process.getuid !== undefined && process.getuid() === 0;
const has = () => existsSync("/usr/bin/sudo");

export const sudo = (args: string[]) => (root() || !has() ? args : ["sudo", ...args]);

export async function command(args: string[]) {
  console.log(`$ ${args.join(" ")}`);
  const [tool, ...toolArgs] = args;
  const exitCode = await exec(tool, toolArgs, {
    cwd: dir,
    ignoreReturnCode: true,
  });
  if (exitCode !== 0) {
    throw new Error(`command failed with exit code ${exitCode}: ${args.join(" ")}`);
  }
}
