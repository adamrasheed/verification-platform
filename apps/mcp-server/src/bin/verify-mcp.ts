#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LocalCanonicalDispatcher } from "@verify-internal/adapter-core";
import { LocalMcpAdapter, createVerifyMcpServer } from "../public/index.js";

interface ServerArguments {
  readonly workspace: string;
  readonly binding: string;
  readonly stateRoot?: string;
}

function parseArguments(argv: readonly string[]): ServerArguments {
  let workspace: string | undefined;
  let binding: string | undefined;
  let stateRoot: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (
      (option === "--workspace" || option === "--binding" || option === "--state-root")
      && value !== undefined
    ) {
      if (option === "--workspace") workspace = value;
      else if (option === "--binding") binding = value;
      else stateRoot = value;
      index += 1;
      continue;
    }
    throw new TypeError(`unknown or incomplete option: ${option ?? "<missing>"}`);
  }
  if (workspace === undefined || binding === undefined) {
    throw new TypeError("--workspace and --binding are required");
  }
  return {
    workspace: path.resolve(workspace),
    binding,
    ...(stateRoot === undefined ? {} : { stateRoot: path.resolve(stateRoot) }),
  };
}

const args = parseArguments(process.argv.slice(2));
const resourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../resources",
);
const [commandEnvelopeSchema, glossary] = await Promise.all([
  readFile(path.join(resourceRoot, "command-envelope.schema.json"), "utf8"),
  readFile(path.join(resourceRoot, "GLOSSARY.md"), "utf8"),
]);
const dispatcher = new LocalCanonicalDispatcher({
  workspace: { id: args.binding, root: args.workspace },
  ...(args.stateRoot === undefined ? {} : { stateRoot: args.stateRoot }),
});
const adapter = new LocalMcpAdapter({ dispatcher, commandEnvelopeSchema, glossary });
const server = createVerifyMcpServer({ adapter, workspaceBinding: args.binding });
const transport = new StdioServerTransport();
const close = async (): Promise<void> => {
  await server.close();
  dispatcher.close();
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
try {
  await server.connect(transport);
} catch (error) {
  dispatcher.close();
  throw error;
}
