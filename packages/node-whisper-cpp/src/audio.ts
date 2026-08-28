import { readFile } from "node:fs/promises";

import { AudioDecodeError } from "./errors.js";
import type { Audio } from "./types.js";

export const SAMPLE_RATE = 16000;

type Decoded = {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
};

const tag = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);

const sampleReader = (
  view: DataView,
  base: number,
  format: number,
  bits: number,
): ((index: number) => number) => {
  if (format === 3 && bits === 32) return (i) => view.getFloat32(base + i * 4, true);
  if (format === 1 || format === 0xfffe) {
    if (bits === 8) return (i) => (view.getUint8(base + i) - 128) / 128;
    if (bits === 16) return (i) => view.getInt16(base + i * 2, true) / 32768;
    if (bits === 24) {
      return (i) => {
        const o = base + i * 3;
        const raw = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
        return (raw & 0x800000 ? raw | ~0xffffff : raw) / 8388608;
      };
    }
    if (bits === 32) return (i) => view.getInt32(base + i * 4, true) / 2147483648;
  }
  throw new AudioDecodeError(`unsupported WAV encoding: format ${format}, ${bits}-bit`);
};

const decodeWav = (bytes: Uint8Array): Decoded => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") {
    throw new AudioDecodeError("not a RIFF/WAVE file");
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.byteLength) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataOffset = body;
      dataLength = Math.min(size, bytes.byteLength - body);
    }
    offset = body + size + (size & 1);
  }

  if (dataOffset < 0 || channels === 0 || sampleRate === 0) {
    throw new AudioDecodeError("missing fmt or data chunk");
  }

  const read = sampleReader(view, dataOffset, format, bits);
  const frames = Math.floor(dataLength / (channels * (bits / 8)));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += read(i * channels + c);
    samples[i] = sum / channels;
  }

  return { samples, sampleRate, channels };
};

const resample = (input: Float32Array, from: number, to: number): Float32Array => {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? a;
    output[i] = a + (b - a) * fraction;
  }
  return output;
};

export const fromWav = (data: ArrayBuffer | Uint8Array): Audio => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decoded = decodeWav(bytes);
  return resample(decoded.samples, decoded.sampleRate, SAMPLE_RATE);
};

export const fromFile = async (path: string): Promise<Audio> => fromWav(await readFile(path));
