# Overview
`node-whisper-cpp` is an npm packages which builds and publishes native `whisper.cpp` binaries, plus a TypeScript package that uses a Node addon plus an ergonomic API to provide access.

# Commands
- `bun run tools/build.ts all --backend cpu` build `whisper.cpp` binaries, a NAPI addon, compiled TypeScript, and tarball NPM packages for the wrapper JS package and the native addon package
  - e.g. on x64, Linux, and glibc, it would produce `spader-node-whisper-cpp-x64-linux-cpu-gnu-0.0.1.tgz` and `spader-node-whisper-cpp-0.0.1.tgz`
  - Use `--ci` to build architecture specific CPU backends as shared libraries (like what is shipped)
  - Use `NODE_WHISPER_CPP_BACKEND` to force a backend through the entire process. The precendence is:
    - `NODE_WHISPER_CPP_BACKEND`
    - `--backend`
    - Simple detection based on the system
- `bun run clean`
- `bun run test` tests installing the tarballs in both TS and JS. Specify backend with `NODE_WHISPER_CPP_BACKEND`; otherwise, defaults to the system default

# Testing

# Rules
- Always verify non-trivial changes with:
```bash
bun run clean
NODE_WHISPER_CPP_BACKEND=cpu bun run tools/build.ts all --ci
NODE_WHISPER_CPP_BACKEND=cpu bun run test
```
- If testing a specific backend, substitute it into the environment
- Never put logic in `package.json` scripts; every script should look like `bun run $script $args`
- Prefer to export a single top-level namespace rather than loose functions and types
