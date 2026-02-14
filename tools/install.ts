import { existsSync } from "node:fs";
import { join } from "node:path";

import { $ } from "bun";

const dir = join(import.meta.dir, "..");

const root = () => process.getuid !== undefined && process.getuid() === 0;
const has = () => existsSync("/usr/bin/sudo");
const sudo = (s: string) => (root() || !has() ? s : `sudo ${s}`);

interface Provider {
  init?: () => string;
  install: (pkg: string) => string;
  batch: (pkgs: string[]) => string;
}

const providers: Record<string, Provider> = {
  apt: {
    init: () => sudo("apt-get update"),
    install: (pkg) => sudo(`apt-get install -y ${pkg}`),
    batch: (pkgs) => sudo(`apt-get install -y ${pkgs.join(" ")}`),
  },
};

export const install = async () => {
  const config = {
    apt: [
      "build-essential",
      "cmake",
      "ninja-build",
      "pkg-config",
      "git",
      "curl",
      "ca-certificates",
      "gnupg",
      "python3",
      "unzip",
    ],
  };

  const commands: string[] = [];

  commands.push(providers.apt.init!());
  commands.push(providers.apt.batch(config.apt));

  commands.push("bun install")

  for (const command of commands) {
    console.log(`$ ${command}`);
    await $`bash -lc ${command}`.cwd(dir);
  }
}
