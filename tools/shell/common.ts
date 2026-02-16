import { existsSync } from "node:fs";
import { join } from "node:path";

import { $ } from "bun";

const dir = join(import.meta.dir, "..", "..");

const root = () => process.getuid !== undefined && process.getuid() === 0;
const has = () => existsSync("/usr/bin/sudo");

export const sudo = (command: string) => (root() || !has() ? command : `sudo ${command}`);

export const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

export async function run(command: string) {
  console.log(`$ ${command}`);
  await $`bash -lc ${command}`.cwd(dir);
}
