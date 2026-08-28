import whisper from "@spader/node-whisper-cpp";

const triple = whisper.platform.detect();
await import(`@spader/node-whisper-cpp-${triple}`);

const modelPath = process.env.WHISPER_SMOKE_MODEL;
const audioPath = process.env.WHISPER_SMOKE_AUDIO;
if (!modelPath || !audioPath) throw new Error("WHISPER_SMOKE_MODEL and WHISPER_SMOKE_AUDIO must be set");

if (typeof whisper.version !== "string" || whisper.version.length === 0) {
  throw new Error("version did not return a non-empty string");
}

if (typeof whisper.systemInfo() !== "string") {
  throw new Error("systemInfo() did not return a string");
}

const audio = await whisper.audio.fromFile(audioPath);
const model = await whisper.load({ model: modelPath, gpu: false });
try {
  const result = await model.transcribe(audio);
  if (!result.text.toLowerCase().includes("ask not what your country")) {
    throw new Error(`unexpected transcription: ${result.text}`);
  }
} finally {
  model.dispose();
}

console.log("smoke-ts-ok");
