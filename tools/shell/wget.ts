import { command } from "./common";

export function wget() {
  let outFile: string | undefined;

  const builder = {
    file(path: string) {
      outFile = path;
      return builder;
    },
    async download(url: string) {
      if (!outFile) {
        throw new Error("wget().download() requires .file(path) first");
      }

      command(["wget", "-q", url, "-O", outFile]);
      return builder;
    },
  };

  return builder;
}
