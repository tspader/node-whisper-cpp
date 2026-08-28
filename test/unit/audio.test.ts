import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { AudioDecodeError, whisper } from "../../packages/node-whisper-cpp/src/index";

type Golden = {
  name: string;
  file: string;
  golden: string;
  expect: { frames: number; exact: boolean };
};

const fixtures = join(import.meta.dir, "..", "fixtures", "audio");
const cases: Golden[] = JSON.parse(readFileSync(join(fixtures, "golden.json"), "utf8"));

const EXACT_TOLERANCE = 1e-5;
const RESAMPLE_TOLERANCE = 1e-4;

const readGolden = (name: string): Float32Array => {
  const buf = readFileSync(join(fixtures, name));
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
};

const maxAbsDiff = (a: Float32Array, b: Float32Array): number => {
  let max = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return max;
};

const runAudioCase = (c: Golden) => {
  const out = whisper.audio.fromWav(readFileSync(join(fixtures, c.file)));
  const golden = readGolden(c.golden);
  const tolerance = c.expect.exact ? EXACT_TOLERANCE : RESAMPLE_TOLERANCE;

  expect(out.length).toBe(c.expect.frames);
  expect(out.length).toBe(golden.length);
  expect(maxAbsDiff(out, golden)).toBeLessThan(tolerance);
};

describe("audio.fromWav", () => {
  for (const c of cases) {
    it(`decodes ${c.name}`, () => runAudioCase(c));
  }
});

type ErrorCase = { name: string; file: string };

const errorCases: ErrorCase[] = [
  { name: "rejects non-riff data", file: "bad-not-riff.bin" },
  { name: "rejects a header with no chunks", file: "bad-empty.wav" },
  { name: "rejects an unsupported encoding", file: "bad-alaw.wav" },
];

const runErrorCase = (c: ErrorCase) => {
  expect(() => whisper.audio.fromWav(readFileSync(join(fixtures, c.file)))).toThrow(AudioDecodeError);
};

describe("audio.fromWav errors", () => {
  for (const c of errorCases) {
    it(c.name, () => runErrorCase(c));
  }
});
