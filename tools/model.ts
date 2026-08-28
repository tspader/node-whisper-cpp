import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL = "ggml-tiny.bin";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL}`;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export const modelDir = (): string =>
  process.env.NODE_WHISPER_CPP_MODEL_DIR || join(repoRoot, ".cache", "models");

export const modelPath = (): string => join(modelDir(), MODEL);

export const ensureModel = async (): Promise<string> => {
  const path = modelPath();
  if (existsSync(path)) return path;

  await mkdir(dirname(path), { recursive: true });
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`failed to download model: ${response.status} ${response.statusText}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(path, bytes);
  return path;
};

if (import.meta.main) {
  console.log(await ensureModel());
}
