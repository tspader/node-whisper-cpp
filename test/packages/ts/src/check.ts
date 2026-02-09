import { createContext, systemInfo, version } from "node-whisper-cpp";

const v = version();
if (typeof v !== "string" || v.length === 0) {
  throw new Error("version() did not return a non-empty string");
}

if (typeof systemInfo() !== "string") {
  throw new Error("systemInfo() did not return a string");
}

const context = createContext({ model: "../../for-tests-ggml-tiny.bin" });
context.free();

console.log("smoke-ts-ok");
