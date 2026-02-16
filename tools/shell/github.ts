import { appendFileSync } from "node:fs";

export function github() {
  const envPath = process.env.GITHUB_ENV;
  const outputPath = process.env.GITHUB_OUTPUT;
  const githubPath = process.env.GITHUB_PATH;

  const builder = {
    export(key: string, value: string) {
      if (envPath) {
        appendFileSync(envPath, `${key}=${value}\n`);
      }
      return builder;
    },
    append(key: string, value: string, separator = ":") {
      const existing = process.env[key] ?? "";
      const combined = existing ? `${value}${separator}${existing}` : value;
      if (envPath) {
        appendFileSync(envPath, `${key}=${combined}\n`);
      }
      return builder;
    },
    path(value: string) {
      if (githubPath) {
        appendFileSync(githubPath, `${value}\n`);
      }
      return builder;
    },
    output(key: string, value: string) {
      if (outputPath) {
        appendFileSync(outputPath, `${key}=${value}\n`);
      }
      return builder;
    },
  };

  return builder;
}
