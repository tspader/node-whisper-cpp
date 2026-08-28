import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TARGET_RATE = 16000;
const DURATION = 0.25;

const outDir = join(import.meta.dir, "..", "fixtures", "audio");
const resampleScript = join(import.meta.dir, "resample.py");

type Spec = {
  name: string;
  codec: string;
  rate: number;
  channels: number;
  exprs: string[];
};

const specs: Spec[] = [
  { name: "s16-16k-mono", codec: "pcm_s16le", rate: 16000, channels: 1, exprs: ["sin(440*2*PI*t)"] },
  { name: "s16-16k-stereo", codec: "pcm_s16le", rate: 16000, channels: 2, exprs: ["sin(440*2*PI*t)", "sin(880*2*PI*t)"] },
  { name: "u8-16k-mono", codec: "pcm_u8", rate: 16000, channels: 1, exprs: ["sin(440*2*PI*t)"] },
  { name: "s24-16k-mono", codec: "pcm_s24le", rate: 16000, channels: 1, exprs: ["0.5*sin(440*2*PI*t)"] },
  { name: "s32-16k-mono", codec: "pcm_s32le", rate: 16000, channels: 1, exprs: ["0.5*sin(440*2*PI*t)"] },
  { name: "f32-16k-mono", codec: "pcm_f32le", rate: 16000, channels: 1, exprs: ["0.5*sin(440*2*PI*t)"] },
  { name: "s16-8k-mono", codec: "pcm_s16le", rate: 8000, channels: 1, exprs: ["sin(440*2*PI*t)"] },
  { name: "s16-44k-mono", codec: "pcm_s16le", rate: 44100, channels: 1, exprs: ["sin(440*2*PI*t)"] },
  { name: "s16-48k-stereo", codec: "pcm_s16le", rate: 48000, channels: 2, exprs: ["sin(440*2*PI*t)", "sin(880*2*PI*t)"] },
];

const ffmpeg = (args: string[]) => {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "buffer" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}\n${result.stderr?.toString()}`);
};

const readF32 = (path: string): Float32Array => {
  const buf = readFileSync(path);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
};

const writeF32 = (path: string, samples: Float32Array) => {
  writeFileSync(path, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
};

const decodeMono = (wav: string, channels: number): Float32Array => {
  const raw = `${wav}.raw`;
  ffmpeg(["-i", wav, "-f", "f32le", "-acodec", "pcm_f32le", raw]);
  const interleaved = readF32(raw);
  rmSync(raw);
  const frames = Math.floor(interleaved.length / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += interleaved[i * channels + c]!;
    mono[i] = sum / channels;
  }
  return mono;
};

const resample = (source: Float32Array, from: number, to: number): Float32Array => {
  const inPath = join(outDir, "resample.in");
  const outPath = join(outDir, "resample.out");
  writeF32(inPath, source);
  const result = spawnSync("python3", [resampleScript, inPath, outPath, String(from), String(to)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`resample failed\n${result.stderr}`);
  const out = readF32(outPath);
  rmSync(inPath);
  rmSync(outPath);
  return out;
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const golden = specs.map((spec) => {
  const wav = join(outDir, `${spec.name}.wav`);
  const lavfi = `aevalsrc=exprs=${spec.exprs.join("|")}:s=${spec.rate}:d=${DURATION}`;
  ffmpeg(["-f", "lavfi", "-i", lavfi, "-c:a", spec.codec, wav]);

  const source = decodeMono(wav, spec.channels);
  const exact = spec.rate === TARGET_RATE;
  const samples = exact ? source : resample(source, spec.rate, TARGET_RATE);

  writeF32(join(outDir, `${spec.name}.f32`), samples);

  return {
    name: spec.name,
    file: `${spec.name}.wav`,
    golden: `${spec.name}.f32`,
    expect: { frames: samples.length, exact },
  };
});

writeFileSync(join(outDir, "golden.json"), `${JSON.stringify(golden, null, 2)}\n`);

const alaw = join(outDir, "bad-alaw.wav");
ffmpeg(["-f", "lavfi", "-i", `aevalsrc=exprs=sin(440*2*PI*t):s=16000:d=${DURATION}`, "-c:a", "pcm_alaw", alaw]);

const riffHeader = Buffer.alloc(12);
riffHeader.write("RIFF", 0, "ascii");
riffHeader.writeUInt32LE(4, 4);
riffHeader.write("WAVE", 8, "ascii");
writeFileSync(join(outDir, "bad-empty.wav"), riffHeader);

writeFileSync(join(outDir, "bad-not-riff.bin"), Buffer.from("this file is definitely not a wave file"));

console.log(`wrote ${golden.length} audio fixtures to ${outDir}`);
