import * as audio from "./audio.js";
import { loadAddon } from "./loader.js";
import { load } from "./model.js";
import * as platform from "./platform.js";

export type {
  Audio,
  Gpu,
  LoadOptions,
  Model,
  ModelInfo,
  Segment,
  Session,
  Token,
  TranscribeOptions,
  TranscriptionResult,
  TranscriptionStream,
  VadOptions,
} from "./types.js";

export { AudioDecodeError, ModelLoadError, TranscribeError } from "./errors.js";

export const whisper = {
  load,
  audio,
  platform,
  get version(): string {
    return loadAddon().version();
  },
  systemInfo: (): string => loadAddon().systemInfo(),
};

export default whisper;
