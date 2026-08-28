import { command, sudo } from "./common";

const APT_RETRIES = 3;
const APT_RETRY_DELAY_MS = 1500;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runWithRetries(args: string[]) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= APT_RETRIES; attempt++) {
    try {
      await command(sudo(args));
      return;
    } catch (error) {
      lastError = error;
      if (attempt === APT_RETRIES) {
        break;
      }

      console.warn(
        `apt command failed (attempt ${attempt}/${APT_RETRIES}): ${args.join(" ")}. Retrying...`
      );
      await delay(APT_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

export function apt() {
  const packages: string[] = [];

  const builder = {
    async update() {
      await runWithRetries(["apt-get", "update"]);
      return builder;
    },
    batch(pkgs: string | string[]) {
      packages.push(...(Array.isArray(pkgs) ? pkgs : [pkgs]));
      return builder;
    },
    async install() {
      if (packages.length > 0) {
        await runWithRetries(["apt-get", "install", "-y", ...packages]);
      }
    },
  };

  return builder;
}
