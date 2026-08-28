import { command, sudo } from "./common";

export function dpkg() {
  return {
    async install(packagePath: string) {
      await command(sudo(["dpkg", "-i", packagePath]));
    },
  };
}
