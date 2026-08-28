import { TranscribeError } from "./errors.js";
import type {
  Audio,
  NativeResult,
  NativeSegment,
  NativeState,
  NativeToken,
  NativeTranscribeOptions,
  Segment,
  Token,
  TranscribeOptions,
  TranscriptionResult,
  TranscriptionStream,
} from "./types.js";

const locks = new WeakMap<NativeState, Promise<unknown>>();

const withLock = <T>(native: NativeState, fn: () => Promise<T>): Promise<T> => {
  const previous = locks.get(native) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(
    native,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
};

const makeAbort = (signal?: AbortSignal): Int32Array | undefined => {
  if (!signal) return undefined;
  const flag = new Int32Array(new SharedArrayBuffer(4));
  if (signal.aborted) Atomics.store(flag, 0, 1);
  else signal.addEventListener("abort", () => Atomics.store(flag, 0, 1), { once: true });
  return flag;
};

const toNative = (
  audio: Audio,
  options: TranscribeOptions,
  onSegment?: (segment: NativeSegment) => void,
): NativeTranscribeOptions => {
  const vad = options.vad;
  const vadOptions = typeof vad === "object" ? vad : undefined;
  return {
    pcm: audio,
    language: options.language ?? "auto",
    translate: options.translate,
    threads: options.threads,
    prompt: options.prompt,
    offsetMs: options.offsetMs,
    durationMs: options.durationMs,
    maxLen: options.maxLen,
    splitOnWord: options.splitOnWord,
    maxTokens: options.maxTokens,
    tokenTimestamps: options.tokenTimestamps,
    diarize: options.diarize,
    temperature: options.temperature,
    temperatureInc: options.temperatureInc,
    beamSize: options.beamSize,
    bestOf: options.bestOf,
    noSpeechThreshold: options.noSpeechThreshold,
    entropyThreshold: options.entropyThreshold,
    logProbThreshold: options.logProbThreshold,
    suppressBlank: options.suppressBlank,
    suppressNonSpeech: options.suppressNonSpeech,
    vad: vad === undefined ? undefined : Boolean(vad),
    vadModel: vadOptions?.model,
    vadThreshold: vadOptions?.threshold,
    vadMinSpeechMs: vadOptions?.minSpeechMs,
    vadMinSilenceMs: vadOptions?.minSilenceMs,
    vadMaxSpeechSeconds: vadOptions?.maxSpeechSeconds,
    vadSpeechPadMs: vadOptions?.speechPadMs,
    vadSamplesOverlap: vadOptions?.samplesOverlap,
    abort: makeAbort(options.signal),
    onProgress: options.onProgress,
    onSegment,
  };
};

const seconds = (centiseconds: number): number => centiseconds / 100;

const mapToken = (token: NativeToken): Token => ({
  text: token.text,
  start: seconds(token.t0),
  end: seconds(token.t1),
  probability: token.p,
});

const mapSegment = (segment: NativeSegment): Segment => ({
  text: segment.text.trim(),
  start: seconds(segment.t0),
  end: seconds(segment.t1),
  noSpeechProb: segment.noSpeechProb,
  ...(segment.speakerTurn !== undefined && { speakerTurn: segment.speakerTurn }),
  ...(segment.tokens && { tokens: segment.tokens.map(mapToken) }),
});

const mapResult = (result: NativeResult): TranscriptionResult => {
  const segments = result.segments.map(mapSegment);
  return {
    text: segments
      .map((segment) => segment.text)
      .join(" ")
      .trim(),
    language: result.language,
    segments,
  };
};

const run = (
  native: NativeState,
  audio: Audio,
  options: TranscribeOptions,
  onSegment?: (segment: NativeSegment) => void,
): Promise<TranscriptionResult> =>
  withLock(native, () =>
    native.transcribe(toNative(audio, options, onSegment)).then(mapResult, (cause) => {
      if (options.signal?.aborted) throw new DOMException("transcription aborted", "AbortError");
      throw new TranscribeError(cause instanceof Error ? cause.message : "transcription failed", cause);
    }),
  );

export const runTranscribe = (
  native: NativeState,
  audio: Audio,
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> => run(native, audio, options);

export const runStream = (
  native: NativeState,
  audio: Audio,
  options: TranscribeOptions = {},
): TranscriptionStream => {
  const queue: Segment[] = [];
  let wake: (() => void) | null = null;
  let finished = false;

  const signal = () => {
    wake?.();
    wake = null;
  };

  const result = run(native, audio, options, (segment) => {
    queue.push(mapSegment(segment));
    signal();
  });

  const done = result.finally(() => {
    finished = true;
    signal();
  });
  done.catch(() => {});

  const iterator = async function* (): AsyncGenerator<Segment> {
    while (true) {
      while (queue.length) yield queue.shift()!;
      if (finished) {
        await done;
        return;
      }
      await new Promise<void>((resolve) => (wake = resolve));
    }
  };

  return Object.assign(done, { [Symbol.asyncIterator]: iterator }) as TranscriptionStream;
};
