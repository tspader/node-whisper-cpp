import { join } from "node:path";

import { beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { ModelLoadError, whisper } from "../../packages/node-whisper-cpp/src/index";
import type { LoadOptions, NativeContextOptions } from "../../packages/node-whisper-cpp/src/types";
import { control, reset } from "../utils/fake-addon";

const ADDON = join(import.meta.dir, "..", "utils", "fake-addon.ts");

beforeAll(() => {
  process.env.NODE_WHISPER_CPP_ADDON = ADDON;
});

beforeEach(() => {
  reset();
});

type LoadCase = {
  name: string;
  options: string | LoadOptions;
  expect: NativeContextOptions;
};

const loadCases: LoadCase[] = [
  { name: "string path defaults gpu on", options: "m.bin", expect: { model: "m.bin", useGpu: true, gpuDevice: 0, flashAttn: false } },
  { name: "gpu disabled", options: { model: "m", gpu: false }, expect: { model: "m", useGpu: false, gpuDevice: 0, flashAttn: false } },
  { name: "gpu enabled", options: { model: "m", gpu: true }, expect: { model: "m", useGpu: true, gpuDevice: 0, flashAttn: false } },
  { name: "gpu device selected", options: { model: "m", gpu: { device: 2 } }, expect: { model: "m", useGpu: true, gpuDevice: 2, flashAttn: false } },
  { name: "flash attention", options: { model: "m", flashAttention: true }, expect: { model: "m", useGpu: true, gpuDevice: 0, flashAttn: true } },
];

const runLoadCase = async (c: LoadCase) => {
  const model = await whisper.load(c.options);
  expect(control().contexts[0]).toEqual(c.expect);
  model.dispose();
};

describe("whisper.load options", () => {
  for (const c of loadCases) {
    it(c.name, () => runLoadCase(c));
  }
});

describe("whisper.load behavior", () => {
  it("wraps load failure in ModelLoadError", async () => {
    control().failLoad = "no model";
    await expect(whisper.load("missing")).rejects.toBeInstanceOf(ModelLoadError);
  });

  it("exposes model info", async () => {
    control().info = { type: "tiny", multilingual: false, vocabSize: 51865, audioContextSize: 1500, textContextSize: 448 };
    const model = await whisper.load("m");
    expect(model.info).toEqual(control().info);
    model.dispose();
  });

  it("frees once across repeated dispose", async () => {
    const model = await whisper.load("m");
    model.dispose();
    model.dispose();
    expect(control().frees).toBe(1);
  });

  it("creates independent sessions", async () => {
    const model = await whisper.load("m");
    const session = model.createSession();
    expect(control().states).toBe(1);
    session.dispose();
    expect(control().frees).toBe(1);
    model.dispose();
  });

  it("frees via Symbol.dispose", async () => {
    {
      using model = await whisper.load("m");
      expect(model.info.type).toBe("fake");
    }
    expect(control().frees).toBe(1);
  });

  it("routes version and system info through the addon", () => {
    expect(whisper.version).toBe("fake-version");
    expect(whisper.systemInfo()).toBe("fake-system-info");
  });
});
