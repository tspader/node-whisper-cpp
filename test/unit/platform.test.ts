import { afterEach, describe, expect, it } from "bun:test";

import type { Backend } from "../../packages/node-whisper-cpp/src/platform";
import { detect, resolveTarget } from "../../packages/node-whisper-cpp/src/platform";

type PlatformCase = {
  name: string;
  env?: string;
  expect: { backend?: Backend; throws?: boolean };
};

const cases: PlatformCase[] = [
  { name: "forces metal", env: "metal", expect: { backend: "metal" } },
  { name: "forces cpu", env: "cpu", expect: { backend: "cpu" } },
  { name: "forces cuda", env: "cuda", expect: { backend: "cuda" } },
  { name: "forces vulkan", env: "vulkan", expect: { backend: "vulkan" } },
  { name: "rejects unknown backend", env: "tpu", expect: { throws: true } },
];

const KEY = "NODE_WHISPER_CPP_BACKEND";
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

const runPlatformCase = (c: PlatformCase) => {
  if (c.env === undefined) delete process.env[KEY];
  else process.env[KEY] = c.env;

  if (c.expect.throws) {
    expect(() => resolveTarget()).toThrow();
    return;
  }

  expect(resolveTarget().backend).toBe(c.expect.backend!);
  expect(detect()).toContain(`-${c.expect.backend}`);
};

describe("platform backend resolution", () => {
  for (const c of cases) {
    it(c.name, () => runPlatformCase(c));
  }
});
