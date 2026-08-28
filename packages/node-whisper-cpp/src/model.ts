import { ModelLoadError } from "./errors.js";
import { loadAddon } from "./loader.js";
import { createSession } from "./session.js";
import { runStream, runTranscribe } from "./transcribe.js";
import type { Audio, LoadOptions, Model, NativeContext, TranscribeOptions } from "./types.js";

const open = (options: LoadOptions): NativeContext => {
  const gpu = options.gpu ?? true;
  try {
    return new (loadAddon().WhisperContext)({
      model: options.model,
      useGpu: gpu !== false,
      gpuDevice: typeof gpu === "object" ? gpu.device ?? 0 : 0,
      flashAttn: options.flashAttention ?? false,
    });
  } catch (cause) {
    throw new ModelLoadError(options.model, cause);
  }
};

export const load = async (options: string | LoadOptions): Promise<Model> => {
  const native = open(typeof options === "string" ? { model: options } : options);
  const info = native.modelInfo();

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    native.free();
  };

  return {
    info,
    transcribe: (audio: Audio, options?: TranscribeOptions) => runTranscribe(native, audio, options),
    transcribeStream: (audio: Audio, options?: TranscribeOptions) => runStream(native, audio, options),
    createSession: () => createSession(native.createState()),
    dispose,
    [Symbol.dispose]: dispose,
  };
};
