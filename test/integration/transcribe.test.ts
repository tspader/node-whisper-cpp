import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { ModelLoadError, whisper } from "../../packages/node-whisper-cpp/src/index";
import { resolve } from "../../packages/node-whisper-cpp/src/platform";
import type { Audio, Model, TranscribeOptions } from "../../packages/node-whisper-cpp/src/types";
import { ensureModel } from "../../tools/model";

const repoRoot = join(import.meta.dir, "..", "..");

if (!process.env.NODE_WHISPER_CPP_ADDON) {
  process.env.NODE_WHISPER_CPP_ADDON = join(repoRoot, ".cache", "store", "addon", resolve("cpu"), "bins", "whisper-addon.node");
}

const normalize = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

let model: Model;
let audio: Audio;
let modelPath: string;

beforeAll(async () => {
  modelPath = await ensureModel();
  audio = await whisper.audio.fromFile(join(repoRoot, "asset", "jfk.wav"));
  model = await whisper.load({ model: modelPath, gpu: false });
});

afterAll(() => {
  model?.dispose();
});

type TranscribeCase = {
  name: string;
  options?: TranscribeOptions;
  expect: { contains: string[]; language: string; minSegments: number };
};

const cases: TranscribeCase[] = [
  { name: "transcribes english speech", expect: { contains: ["ask not what your country", "do for your country"], language: "en", minSegments: 1 } },
  { name: "honors explicit language", options: { language: "en" }, expect: { contains: ["ask not what your country"], language: "en", minSegments: 1 } },
];

const runTranscribeCase = async (c: TranscribeCase) => {
  const result = await model.transcribe(audio, c.options);
  const text = normalize(result.text);

  for (const phrase of c.expect.contains) expect(text).toContain(phrase);
  expect(result.language).toBe(c.expect.language);
  expect(result.segments.length).toBeGreaterThanOrEqual(c.expect.minSegments);

  for (const segment of result.segments) {
    expect(segment.end).toBeGreaterThanOrEqual(segment.start);
    expect(segment.start).toBeGreaterThanOrEqual(0);
  }
};

describe("transcription", () => {
  for (const c of cases) {
    it(c.name, () => runTranscribeCase(c), 60000);
  }
});

describe("transcription behavior", () => {
  it("streams the same text it resolves", async () => {
    const stream = model.transcribeStream(audio);
    const streamed: string[] = [];
    for await (const segment of stream) streamed.push(segment.text);
    const result = await stream;
    expect(streamed.length).toBe(result.segments.length);
    expect(normalize(streamed.join(" "))).toBe(normalize(result.text));
  }, 60000);

  it("transcribes through a session", async () => {
    using session = model.createSession();
    const result = await session.transcribe(audio);
    expect(normalize(result.text)).toContain("ask not what your country");
  }, 60000);

  it("aborts a running transcription", async () => {
    const controller = new AbortController();
    const pending = model.transcribe(audio, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  }, 60000);

  it("exposes model info", () => {
    expect(model.info.type.length).toBeGreaterThan(0);
    expect(model.info.vocabSize).toBeGreaterThan(0);
    expect(model.info.multilingual).toBe(true);
  });

  it("reports version and system info", () => {
    expect(typeof whisper.version).toBe("string");
    expect(whisper.version.length).toBeGreaterThan(0);
    expect(typeof whisper.systemInfo()).toBe("string");
  });

  it("rejects a missing model with ModelLoadError", async () => {
    await expect(whisper.load({ model: join(repoRoot, "asset", "does-not-exist.bin"), gpu: false })).rejects.toBeInstanceOf(ModelLoadError);
  });
});
