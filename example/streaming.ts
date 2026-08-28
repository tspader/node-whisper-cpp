import whisper from "@spader/node-whisper-cpp";
import { ensureModel, wav } from "./asset";

using model = await whisper.load(await ensureModel());
const audio = await whisper.audio.fromFile(wav);

const stream = model.transcribeStream(audio);

const at = (seconds: number) => seconds.toFixed(1).padStart(5);
for await (const segment of stream) {
  console.log(`[${at(segment.start)} → ${at(segment.end)}] ${segment.text}`);
}

const result = await stream;
console.log(`\n${result.segments.length} segments in ${result.language}`);
