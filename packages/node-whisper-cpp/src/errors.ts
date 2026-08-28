export class ModelLoadError extends Error {
  constructor(model: string, cause?: unknown) {
    super(`failed to load whisper model: ${model}`, { cause });
    this.name = "ModelLoadError";
  }
}

export class TranscribeError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "TranscribeError";
  }
}

export class AudioDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioDecodeError";
  }
}
