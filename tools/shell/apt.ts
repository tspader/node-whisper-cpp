import { quote, run, sudo } from "./common";

export function apt() {
  const packages: string[] = [];

  const builder = {
    async update() {
      await run(sudo("apt-get update"));
      return builder;
    },
    batch(pkgs: string | string[]) {
      packages.push(...(Array.isArray(pkgs) ? pkgs : [pkgs]));
      return builder;
    },
    async install() {
      if (packages.length > 0) {
        await run(sudo(`apt-get install -y ${packages.map(quote).join(" ")}`));
      }
    },
  };

  return builder;
}
