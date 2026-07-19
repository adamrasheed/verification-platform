#!/usr/bin/env node

const controller = new AbortController();
const cancel = (signal: NodeJS.Signals): void => {
  controller.abort(new Error(`received ${signal}`));
};
const onSigint = (): void => cancel("SIGINT");
const onSigterm = (): void => cancel("SIGTERM");

process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);
process.send?.({ type: "verify.cli.ready" });

const {
  LocalRuntimeAdapter,
  defaultLocalStateRoot,
  parseCli,
  runCli,
} = await import("../public/index.js");

const argv = process.argv.slice(2);
const cwd = process.cwd();
const parsed = parseCli(argv, cwd);
const needsRuntime =
  parsed.ok &&
  parsed.command.kind !== "version" &&
  parsed.command.kind !== "schema";
const runtime = needsRuntime
  ? new LocalRuntimeAdapter(defaultLocalStateRoot(cwd))
  : undefined;

try {
  process.exitCode = await runCli(
    argv,
    {
      cwd,
      platform: process.platform,
      stdout: (chunk: string): void => {
        process.stdout.write(chunk);
      },
      stderr: (chunk: string): void => {
        process.stderr.write(chunk);
      },
      now: (): number => Date.now(),
      nowIso: (): string => new Date().toISOString(),
    },
    {
      signal: controller.signal,
      ...(runtime === undefined
        ? {}
        : { engine: runtime, persistence: runtime }),
    },
  );
} finally {
  runtime?.close();
  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
}
