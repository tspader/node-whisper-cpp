import whisper from "@spader/node-whisper-cpp";
import { ensureModel, wav } from "./asset";

using model = await whisper.load(await ensureModel());
const audio = await whisper.audio.fromFile(wav);

const result = await model.transcribe(audio);

console.log(`language: ${result.language}`);
console.log(result.text);
