import whisper from "@spader/node-whisper-cpp";
import { ensureModel, wav } from "./asset";

using model = await whisper.load({ model: await ensureModel(), gpu: false });
console.log(`${model.info.type} (${model.info.multilingual ? "multilingual" : "english"})`);

const audio = await whisper.audio.fromFile(wav);

const result = await model.transcribe(audio, {
  language: "en",
  prompt: "The following is a presidential address.",
  tokenTimestamps: true,
  temperature: 0,
  onProgress: (progress) => process.stdout.write(`\rdecoding ${Math.round(progress * 100)}%`),
});
process.stdout.write("\n");

const words = result.segments.flatMap((segment) => segment.tokens ?? []).filter((token) => !token.text.startsWith("[_"));
console.log(`${words.length} word tokens, ${result.text.length} chars`);

const weakest = [...words].sort((a, b) => a.probability - b.probability).at(0);
if (weakest) {
  console.log(
    `least confident: "${weakest.text.trim()}" @ ${weakest.start.toFixed(2)}s (p=${weakest.probability.toFixed(2)})`,
  );
}
