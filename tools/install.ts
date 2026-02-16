import { apt } from "./shell/apt";
import { command } from "./shell/common";

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

  await apt().update();
  await apt().batch(config.apt).install();

  command(["bun", "install"]);
}
