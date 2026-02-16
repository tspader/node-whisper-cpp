import { command, sudo } from "./common";

export function dpkg() {
  return {
    async install(packagePath: string) {
      command(sudo(["dpkg", "-i", packagePath]));
    },
  };
}
