import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NativeAddon } from "./types.js";
import { detect } from "./platform.js";

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));

function resolvePlatformPackageDir(name: string): string {
  try {
    const entry = require.resolve(name);
    return join(dirname(entry), "..");
  } catch {
    const prefix = "@spader/node-whisper-cpp-";
    return join(currentDir, "..", "packages", "platform", name.slice(prefix.length));
  }
}

function defaultAddonPath(): string {
  const triple = detect();
  const name = `@spader/node-whisper-cpp-${triple}`;
  const dir = resolvePlatformPackageDir(name);
  return join(dir, "bins", "whisper-addon.node");
}

const cache = new Map<string, NativeAddon>();

export function loadAddon(): NativeAddon {
  const addonPath = process.env.NODE_WHISPER_CPP_ADDON || defaultAddonPath();

  const cached = cache.get(addonPath);
  if (cached) return cached;

  const addon = require(addonPath) as NativeAddon;
  cache.set(addonPath, addon);
  return addon;
}
