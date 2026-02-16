import * as core from "@actions/core";

export function github() {
  const envPath = process.env.GITHUB_ENV;
  const outputPath = process.env.GITHUB_OUTPUT;
  const githubPath = process.env.GITHUB_PATH;

  const builder = {
    export(key: string, value: string) {
      if (envPath) {
        core.exportVariable(key, value);
      }
      return builder;
    },
    append(key: string, value: string, separator = ":") {
      const existing = process.env[key] ?? "";
      const combined = existing ? `${value}${separator}${existing}` : value;
      if (envPath) {
        core.exportVariable(key, combined);
      }
      return builder;
    },
    path(value: string) {
      if (githubPath) {
        core.addPath(value);
      }
      return builder;
    },
    output(key: string, value: string) {
      if (outputPath) {
        core.setOutput(key, value);
      }
      return builder;
    },
  };

  return builder;
}
