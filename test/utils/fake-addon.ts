import type {
  NativeContextOptions,
  NativeModelInfo,
  NativeResult,
  NativeState,
  NativeTranscribeOptions,
} from "../../packages/node-whisper-cpp/src/types";

export type FakeControl = {
  result: NativeResult;
  info: NativeModelInfo;
  failLoad?: string;
  failTranscribe?: string;
  delayMs: number;
  contexts: NativeContextOptions[];
  transcribes: NativeTranscribeOptions[];
  states: number;
  frees: number;
};

const fresh = (): FakeControl => ({
  result: { language: "en", segments: [] },
  info: { type: "fake", multilingual: true, vocabSize: 0, audioContextSize: 0, textContextSize: 0 },
  delayMs: 0,
  contexts: [],
  transcribes: [],
  states: 0,
  frees: 0,
});

const slot = globalThis as { __whisperFake?: FakeControl };

export const control = (): FakeControl => (slot.__whisperFake ??= fresh());
export const reset = (): FakeControl => (slot.__whisperFake = fresh());

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const transcribe = async (options: NativeTranscribeOptions): Promise<NativeResult> => {
  const c = control();
  c.transcribes.push(options);
  if (c.delayMs) await sleep(c.delayMs);
  if (options.abort && Atomics.load(options.abort, 0) === 1) throw new Error("aborted");
  if (c.failTranscribe) throw new Error(c.failTranscribe);
  options.onProgress?.(1);
  for (const segment of c.result.segments) options.onSegment?.(segment);
  return c.result;
};

const makeState = (): NativeState => ({ transcribe, free: () => { control().frees++; } });

export class WhisperContext {
  constructor(options: NativeContextOptions) {
    const c = control();
    if (c.failLoad) throw new Error(c.failLoad);
    c.contexts.push(options);
  }
  transcribe = transcribe;
  free = () => { control().frees++; };
  createState(): NativeState {
    control().states++;
    return makeState();
  }
  modelInfo(): NativeModelInfo {
    return control().info;
  }
}

export const version = (): string => "fake-version";
export const systemInfo = (): string => "fake-system-info";
