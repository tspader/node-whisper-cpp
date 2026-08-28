import { join } from "node:path";

import { beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { TranscribeError, whisper } from "../../packages/node-whisper-cpp/src/index";
import type {
  NativeResult,
  NativeTranscribeOptions,
  TranscribeOptions,
  TranscriptionResult,
} from "../../packages/node-whisper-cpp/src/types";
import { control, reset } from "../utils/fake-addon";

const ADDON = join(import.meta.dir, "..", "utils", "fake-addon.ts");
const AUDIO = new Float32Array(16);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeAll(() => {
  process.env.NODE_WHISPER_CPP_ADDON = ADDON;
});

beforeEach(() => {
  reset();
});

type MapCase = {
  name: string;
  native: NativeResult;
  expect: TranscriptionResult;
};

const mapCases: MapCase[] = [
  {
    name: "converts centiseconds and trims",
    native: { language: "en", segments: [{ text: " Hello ", t0: 0, t1: 150, noSpeechProb: 0.1 }] },
    expect: { text: "Hello", language: "en", segments: [{ text: "Hello", start: 0, end: 1.5, noSpeechProb: 0.1 }] },
  },
  {
    name: "joins segments into text",
    native: {
      language: "en",
      segments: [
        { text: " one", t0: 0, t1: 50, noSpeechProb: 0 },
        { text: "two ", t0: 50, t1: 100, noSpeechProb: 0 },
      ],
    },
    expect: {
      text: "one two",
      language: "en",
      segments: [
        { text: "one", start: 0, end: 0.5, noSpeechProb: 0 },
        { text: "two", start: 0.5, end: 1, noSpeechProb: 0 },
      ],
    },
  },
  {
    name: "maps tokens and speaker turns",
    native: {
      language: "de",
      segments: [{ text: "x", t0: 0, t1: 100, noSpeechProb: 0, speakerTurn: true, tokens: [{ text: "x", t0: 0, t1: 100, p: 0.9 }] }],
    },
    expect: {
      text: "x",
      language: "de",
      segments: [{ text: "x", start: 0, end: 1, noSpeechProb: 0, speakerTurn: true, tokens: [{ text: "x", start: 0, end: 1, probability: 0.9 }] }],
    },
  },
  {
    name: "empty result yields empty text",
    native: { language: "auto", segments: [] },
    expect: { text: "", language: "auto", segments: [] },
  },
];

const runMapCase = async (c: MapCase) => {
  control().result = c.native;
  const model = await whisper.load("m");
  expect(await model.transcribe(AUDIO)).toEqual(c.expect);
  model.dispose();
};

describe("transcribe result mapping", () => {
  for (const c of mapCases) {
    it(c.name, () => runMapCase(c));
  }
});

type OptionCase = {
  name: string;
  options: TranscribeOptions;
  expect: Partial<NativeTranscribeOptions>;
};

const optionCases: OptionCase[] = [
  { name: "defaults language to auto", options: {}, expect: { language: "auto" } },
  { name: "passes language", options: { language: "fr" }, expect: { language: "fr" } },
  { name: "passes scalar options", options: { translate: true, threads: 4, beamSize: 5, temperature: 0.2 }, expect: { translate: true, threads: 4, beamSize: 5, temperature: 0.2 } },
  { name: "boolean vad sets flag only", options: { vad: true }, expect: { vad: true, vadModel: undefined, vadThreshold: undefined } },
  {
    name: "object vad flattens every field",
    options: { vad: { model: "v.bin", threshold: 0.7, minSpeechMs: 120, minSilenceMs: 200, maxSpeechSeconds: 30, speechPadMs: 50, samplesOverlap: 0.1 } },
    expect: { vad: true, vadModel: "v.bin", vadThreshold: 0.7, vadMinSpeechMs: 120, vadMinSilenceMs: 200, vadMaxSpeechSeconds: 30, vadSpeechPadMs: 50, vadSamplesOverlap: 0.1 },
  },
];

const runOptionCase = async (c: OptionCase) => {
  const model = await whisper.load("m");
  await model.transcribe(AUDIO, c.options);
  expect(control().transcribes[0]).toMatchObject(c.expect);
  model.dispose();
};

describe("transcribe option mapping", () => {
  for (const c of optionCases) {
    it(c.name, () => runOptionCase(c));
  }
});

describe("transcribe behavior", () => {
  it("streams segments then resolves", async () => {
    control().result = {
      language: "en",
      segments: [
        { text: "a", t0: 0, t1: 50, noSpeechProb: 0 },
        { text: "b", t0: 50, t1: 100, noSpeechProb: 0 },
      ],
    };
    const model = await whisper.load("m");
    const stream = model.transcribeStream(AUDIO);
    const seen: string[] = [];
    for await (const segment of stream) seen.push(segment.text);
    expect(seen).toEqual(["a", "b"]);
    expect((await stream).text).toBe("a b");
    model.dispose();
  });

  it("reports progress", async () => {
    const model = await whisper.load("m");
    const progress: number[] = [];
    await model.transcribe(AUDIO, { onProgress: (p) => progress.push(p) });
    expect(progress).toEqual([1]);
    model.dispose();
  });

  it("propagates the abort flag and rejects with AbortError", async () => {
    control().delayMs = 50;
    const model = await whisper.load("m");
    const controller = new AbortController();
    const pending = model.transcribe(AUDIO, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(Atomics.load(control().transcribes[0]!.abort!, 0)).toBe(1);
    model.dispose();
  });

  it("wraps backend failure in TranscribeError", async () => {
    control().failTranscribe = "boom";
    const model = await whisper.load("m");
    await expect(model.transcribe(AUDIO)).rejects.toBeInstanceOf(TranscribeError);
    model.dispose();
  });

  it("serializes concurrent transcriptions on one state", async () => {
    control().delayMs = 30;
    const model = await whisper.load("m");
    const first = model.transcribe(AUDIO);
    const second = model.transcribe(AUDIO);
    await sleep(5);
    expect(control().transcribes.length).toBe(1);
    await Promise.all([first, second]);
    expect(control().transcribes.length).toBe(2);
    model.dispose();
  });
});

describe("session", () => {
  it("transcribes on its own state and frees on dispose", async () => {
    control().result = { language: "en", segments: [{ text: " hi ", t0: 0, t1: 100, noSpeechProb: 0 }] };
    const model = await whisper.load("m");
    const session = model.createSession();
    expect(await session.transcribe(AUDIO)).toEqual({ text: "hi", language: "en", segments: [{ text: "hi", start: 0, end: 1, noSpeechProb: 0 }] });
    session.dispose();
    expect(control().frees).toBe(1);
    model.dispose();
    expect(control().frees).toBe(2);
  });

  it("streams through a session and disposes via Symbol.dispose", async () => {
    control().result = {
      language: "en",
      segments: [
        { text: "a", t0: 0, t1: 50, noSpeechProb: 0 },
        { text: "b", t0: 50, t1: 100, noSpeechProb: 0 },
      ],
    };
    const model = await whisper.load("m");
    {
      using session = model.createSession();
      const seen: string[] = [];
      for await (const segment of session.transcribeStream(AUDIO)) seen.push(segment.text);
      expect(seen).toEqual(["a", "b"]);
    }
    expect(control().frees).toBe(1);
    model.dispose();
  });
});
