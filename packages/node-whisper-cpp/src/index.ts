import { loadAddon } from "./loader.js";
import type {
  ContextOptions,
  NativeContext,
  Segment,
  TranscribeOptions,
} from "./types.js";

export type { ContextOptions, Segment, TranscribeOptions };

export function version(): string {
  return loadAddon().version();
}

export function systemInfo(): string {
  return loadAddon().systemInfo();
}

export function createContext(options: ContextOptions): Context {
  return new Context(options);
}

export class Context {
  private readonly native: NativeContext;

  constructor(options: ContextOptions) {
    this.native = new (loadAddon().WhisperContext)(options);
  }

  transcribe(options: TranscribeOptions): Promise<Segment[]> {
    return this.native.transcribe(options);
  }

  free(): void {
    this.native.free();
  }
}
