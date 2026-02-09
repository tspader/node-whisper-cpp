import { createRequire } from "node:module";
import { platform, arch } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NativeAddon } from "./types.js";

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));

const platformPackages: Record<string, string> = {
  "darwin-arm64": "@node-whisper-cpp/mac-arm64-metal",
  "linux-x64": "@node-whisper-cpp/linux-x64-cpu",
};

function getPlatformKey() {
  return `${platform}-${arch}`;
}

function resolvePlatformPackageName(): string {
  const platformKey = getPlatformKey();
  const packageName = platformPackages[platformKey];
  if (packageName) {
    return packageName;
  }

  throw new Error(
    `Unsupported platform ${platformKey}. Supported platforms: ${Object.keys(platformPackages).join(", ")}`
  );
}

function resolvePlatformPackageDir(packageName: string): string {
  try {
    const entryPath = require.resolve(packageName);
    return join(dirname(entryPath), "..");
  } catch {
    const packageDirName = packageName.split("/")[1];
    return join(
      currentDir,
      "..",
      "packages",
      "@node-whisper-cpp",
      packageDirName
    );
  }
}

let addonCache: NativeAddon | null = null;

export function loadAddon(): NativeAddon {
  if (addonCache != null) {
    return addonCache;
  }

  const packageName = resolvePlatformPackageName();
  const packageDir = resolvePlatformPackageDir(packageName);
  const binsDir = join(packageDir, "bins");
  const addonPath = join(binsDir, "whisper-addon.node");

  addonCache = require(addonPath) as NativeAddon;
  return addonCache;
}
