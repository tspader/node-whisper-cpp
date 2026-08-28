import { runStream, runTranscribe } from "./transcribe.js";
import type { Audio, NativeState, Session, TranscribeOptions } from "./types.js";

export const createSession = (native: NativeState): Session => {
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    native.free();
  };

  return {
    transcribe: (audio: Audio, options?: TranscribeOptions) => runTranscribe(native, audio, options),
    transcribeStream: (audio: Audio, options?: TranscribeOptions) => runStream(native, audio, options),
    dispose,
    [Symbol.dispose]: dispose,
  };
};
