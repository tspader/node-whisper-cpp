import yargs from "yargs";
import { hideBin } from "yargs/helpers";

type Target = "x64-linux-cpu-gnu" | "x64-linux-cuda-gnu" | "arm64-darwin-metal";

const jobs: Record<Target, string> = {
  "x64-linux-cpu-gnu": "build-cpu",
  "x64-linux-cuda-gnu": "build-cuda",
  "arm64-darwin-metal": "build-metal",
};

async function runBuild(target: Target, dryRun: boolean) {
  const args = [
    "workflow_dispatch",
    "-W", ".github/workflows/build-single.yml",
    "--input", `target=${target}`,
    "-j", jobs[target],
    "-P", "ubuntu-22.04=ghcr.io/catthehacker/ubuntu:act-22.04",
    "--env", "ACT=true",
    ...(target === "x64-linux-cuda-gnu" ? ["--privileged"] : []),
    ...(dryRun ? ["-n"] : []),
  ];

  const proc = Bun.spawn(["act", ...args], {
    cwd: `${import.meta.dir}/..`,
    stdio: ["inherit", "inherit", "inherit"],
  });

  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`act exited with code ${code}`);
  }
}

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName("act")
    .command(
      "build",
      "Run build-single workflow with act",
      (command) =>
        command
          .option("target", {
            type: "string",
            choices: ["x64-linux-cpu-gnu", "x64-linux-cuda-gnu", "arm64-darwin-metal"] as const,
            default: "x64-linux-cpu-gnu",
          })
          .option("dry-run", {
            type: "boolean",
            default: false,
          }),
      async (argv) => {
        await runBuild(argv.target as Target, argv.dryRun as boolean);
      },
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}

if (import.meta.main) void main();
