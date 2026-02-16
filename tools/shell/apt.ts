import { command, sudo } from "./common";

export function apt() {
  const packages: string[] = [];

  const builder = {
    async update() {
      command(sudo(["apt-get", "update"]));
      return builder;
    },
    batch(pkgs: string | string[]) {
      packages.push(...(Array.isArray(pkgs) ? pkgs : [pkgs]));
      return builder;
    },
    async install() {
      if (packages.length > 0) {
        command(sudo(["apt-get", "install", "-y", ...packages]));
      }
    },
  };

  return builder;
}
