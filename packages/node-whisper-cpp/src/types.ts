export type Audio = Float32Array;

export type Gpu = boolean | { device?: number };

export type LoadOptions = {
  model: string;
  gpu?: Gpu;
  flashAttention?: boolean;
};

export type ModelInfo = {
  type: string;
  multilingual: boolean;
  vocabSize: number;
  audioContextSize: number;
  textContextSize: number;
};

export type VadOptions = {
  model: string;
  threshold?: number;
  minSpeechMs?: number;
  minSilenceMs?: number;
  maxSpeechSeconds?: number;
  speechPadMs?: number;
  samplesOverlap?: number;
};

export type TranscribeOptions = {
  language?: string;
  translate?: boolean;
  threads?: number;
  prompt?: string;
  offsetMs?: number;
  durationMs?: number;
  maxLen?: number;
  splitOnWord?: boolean;
  maxTokens?: number;
  tokenTimestamps?: boolean;
  diarize?: boolean;
  temperature?: number;
  temperatureInc?: number;
  beamSize?: number;
  bestOf?: number;
  noSpeechThreshold?: number;
  entropyThreshold?: number;
  logProbThreshold?: number;
  suppressBlank?: boolean;
  suppressNonSpeech?: boolean;
  vad?: boolean | VadOptions;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

export type Token = {
  text: string;
  start: number;
  end: number;
  probability: number;
};

export type Segment = {
  text: string;
  start: number;
  end: number;
  noSpeechProb: number;
  speakerTurn?: boolean;
  tokens?: Token[];
};

export type TranscriptionResult = {
  text: string;
  language: string;
  segments: Segment[];
};

export type TranscriptionStream = AsyncIterable<Segment> & Promise<TranscriptionResult>;

export type Session = {
  transcribe(audio: Audio, options?: TranscribeOptions): Promise<TranscriptionResult>;
  transcribeStream(audio: Audio, options?: TranscribeOptions): TranscriptionStream;
  dispose(): void;
  [Symbol.dispose](): void;
};

export type Model = {
  readonly info: ModelInfo;
  transcribe(audio: Audio, options?: TranscribeOptions): Promise<TranscriptionResult>;
  transcribeStream(audio: Audio, options?: TranscribeOptions): TranscriptionStream;
  createSession(): Session;
  dispose(): void;
  [Symbol.dispose](): void;
};

export type NativeToken = {
  text: string;
  t0: number;
  t1: number;
  p: number;
};

export type NativeSegment = {
  text: string;
  t0: number;
  t1: number;
  noSpeechProb: number;
  speakerTurn?: boolean;
  tokens?: NativeToken[];
};

export type NativeResult = {
  language: string;
  segments: NativeSegment[];
};

export type NativeTranscribeOptions = {
  pcm: Float32Array;
  language?: string;
  translate?: boolean;
  threads?: number;
  prompt?: string;
  offsetMs?: number;
  durationMs?: number;
  maxLen?: number;
  splitOnWord?: boolean;
  maxTokens?: number;
  tokenTimestamps?: boolean;
  diarize?: boolean;
  temperature?: number;
  temperatureInc?: number;
  beamSize?: number;
  bestOf?: number;
  noSpeechThreshold?: number;
  entropyThreshold?: number;
  logProbThreshold?: number;
  suppressBlank?: boolean;
  suppressNonSpeech?: boolean;
  vad?: boolean;
  vadModel?: string;
  vadThreshold?: number;
  vadMinSpeechMs?: number;
  vadMinSilenceMs?: number;
  vadMaxSpeechSeconds?: number;
  vadSpeechPadMs?: number;
  vadSamplesOverlap?: number;
  abort?: Int32Array;
  onSegment?: (segment: NativeSegment) => void;
  onProgress?: (progress: number) => void;
};

export type NativeModelInfo = {
  type: string;
  multilingual: boolean;
  vocabSize: number;
  audioContextSize: number;
  textContextSize: number;
};

export type NativeContextOptions = {
  model: string;
  useGpu: boolean;
  gpuDevice: number;
  flashAttn: boolean;
};

export type NativeState = {
  transcribe(options: NativeTranscribeOptions): Promise<NativeResult>;
  free(): void;
};

export type NativeContext = NativeState & {
  createState(): NativeState;
  modelInfo(): NativeModelInfo;
};

export type NativeAddon = {
  WhisperContext: new (options: NativeContextOptions) => NativeContext;
  version(): string;
  systemInfo(): string;
};
