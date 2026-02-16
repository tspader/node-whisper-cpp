import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "..");

const root = () => process.getuid !== undefined && process.getuid() === 0;
const has = () => existsSync("/usr/bin/sudo");

export const sudo = (args: string[]) => (root() || !has() ? args : ["sudo", ...args]);

export function command(args: string[]) {
  console.log(`$ ${args.join(" ")}`);
  const proc = Bun.spawnSync(args, {
    cwd: dir,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (!proc.success) {
    throw new Error(`command failed with exit code ${proc.exitCode}: ${args.join(" ")}`);
  }
}
