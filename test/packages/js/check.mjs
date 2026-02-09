import { createContext, systemInfo, version } from "node-whisper-cpp";

const platformPackages = {
  "darwin-arm64": "@node-whisper-cpp/mac-arm64-metal",
  "linux-x64": "@node-whisper-cpp/linux-x64-cpu",
};

const platformKey = `${process.platform}-${process.arch}`;
const platformPackage = platformPackages[platformKey];
if (platformPackage == null) {
  throw new Error(`Unsupported platform for smoke test: ${platformKey}`);
}

await import(platformPackage);

if (typeof version() !== "string" || version().length === 0) {
  throw new Error("version() did not return a non-empty string");
}

if (typeof systemInfo() !== "string") {
  throw new Error("systemInfo() did not return a string");
}

const context = createContext({ model: "../../for-tests-ggml-tiny.bin" });
context.free();

console.log("smoke-js-ok");
