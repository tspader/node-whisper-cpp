import { execSync } from "node:child_process"
import { platform as os, arch } from "node:process"

export type Os = "darwin" | "linux";
export type Architecture = "arm64" | "x64";
export type Backend = "metal" | "cpu" | "cuda" | "vulkan";
export type Libc = "gnu" | "musl" | "apple";

export type Target = {
  os: Os
  arch: Architecture
  backend: Backend
  libc: Libc
};


function detectLibc(): Libc {
  if (os == "darwin") {
    return "apple";
  }
  else if (os == "linux") {
    try {
      const result = execSync("ldd --version 2>&1", { encoding: "utf8" })
      return result.includes("musl") ? "musl" : "gnu"
    } catch (e: any) {
      return e.stdout?.includes("musl") ? "musl" : "gnu"
    }
  }

  throw new Error(`Unsupported OS: ${os}`)
}

const VALID_BACKENDS: readonly Backend[] = ["metal", "cpu", "cuda", "vulkan"];

function detectBackend(): Backend {
  const env = process.env.NODE_WHISPER_CPP_BACKEND;
  if (env) {
    if (!VALID_BACKENDS.includes(env as Backend)) {
      throw new Error(`Invalid NODE_WHISPER_CPP_BACKEND: ${env} (expected one of ${VALID_BACKENDS.join(", ")})`);
    }
    return env as Backend;
  }

  if (os == "darwin") {
    return "metal";
  }
  else if (os == "linux") {
    try { execSync("nvidia-smi", { stdio: "ignore" }); return "cuda" } catch {}
    try { execSync("vulkaninfo", { stdio: "ignore" }); return "vulkan" } catch {}
    return "cpu"
  }

  throw new Error(`Unsupported OS: ${os}`)
}

const getPlatformId = (target: Target) => {
  const parts: string[] = [target.arch, target.os, target.backend]
  if (os === "linux") {
    parts.push(target.libc)
  }
  return parts.join("-")
}

const getPackageName = (target: Target) => {
  return `node-whisper-cpp-${getPlatformId(target)}`
}

function detect(): string {
  const target: Target = detectTarget()
  return getPlatformId(target)
}

function detectTarget(): Target {
  if (os !== "linux" && os !== "darwin") {
    throw new Error(`Unsupported OS: ${os}`)
  }

  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported architecture: ${arch}`)
  }

  return { os, arch, backend: detectBackend(), libc: detectLibc() }
}

function resolve(backend?: Backend): string {
  const target: Target = resolveTarget(backend);
  return getPlatformId(target);
}

function resolveTarget(backend?: Backend): Target {
  const detected: Target = detectTarget()
  return {
    ...detected,
    backend: backend ?? detected.backend,
  }
}


export { detect, detectTarget, resolve, resolveTarget, getPlatformId, getPackageName }
