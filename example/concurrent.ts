import whisper from "@spader/node-whisper-cpp";
import type { Model, TranscribeOptions } from "@spader/node-whisper-cpp";
import { ensureModel, wav } from "./asset";

using model = await whisper.load(await ensureModel());
const audio = await whisper.audio.fromFile(wav);

const windows: TranscribeOptions[] = [
  { offsetMs: 0, durationMs: 5500 },
  { offsetMs: 5500, durationMs: 5500 },
];

const transcribe = async (model: Model, window: TranscribeOptions) => {
  using session = model.createSession();
  return await session.transcribe(audio, window);
};

const results = await Promise.all(windows.map((window) => transcribe(model, window)));

for (const result of results) {
  console.log(result.text.trim());
}
