export interface ContextOptions {
  model: string;
  use_gpu?: boolean;
  flash_attn?: boolean;
  gpu_device?: number;
}

export interface Segment {
  t0: number;
  t1: number;
  text: string;
}

export interface TranscribeOptions {
  pcm: Float32Array;
  language?: string;
  threads?: number;
  onSegment?: (segment: Segment) => void;
}

export interface NativeContext {
  transcribe(options: TranscribeOptions): Promise<Segment[]>;
  free(): void;
}

export interface NativeAddon {
  WhisperContext: new (options: ContextOptions) => NativeContext;
  version(): string;
  systemInfo(): string;
}
