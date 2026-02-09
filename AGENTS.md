# Overview
`node-whisper-cpp` is an npm packages which builds and publishes native `whisper.cpp` binaries, plus a TypeScript package that uses a Node addon plus an ergonomic API to provide access.

# Commands
- `bun run build:system` builds for your current platform, and outputs:
  - `.cache/store/whisper.cpp`: `whisper.cpp` headers and native binaries
  - `.cache/store/addon/$platform`: `package.json`, native binaries, and `.node` addon
  - `.cache/store/js`: JavaScript compiled from our TypeScript sources
  - `.cache/store/npm/`: Tarball NPM packages
    - `@node-whisper-cpp/$platform`: The platform-specific package containing the addon
    - `node-whisper-cpp`: The platform-agnostic package containing the JS loader and API

# Rules
- Never put logic in `package.json` scripts; every script should look like `bun run $script $args`
- Prefer to export a single top-level namespace rather than loose functions and types
