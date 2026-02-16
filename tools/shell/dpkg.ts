import { quote, run, sudo } from "./common";

export function dpkg() {
  return {
    async install(packagePath: string) {
      await run(sudo(`dpkg -i ${quote(packagePath)}`));
    },
  };
}
