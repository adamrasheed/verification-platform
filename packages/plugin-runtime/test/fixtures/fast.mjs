import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.messageType === "handshake.request") {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "handshake.response",
      requestId: message.requestId,
      payload: { selectedVersion: { major: 1, minor: 0 }, pluginId: "synthetic-fast" },
    })}\n`);
  } else if (message.messageType === "operation.request") {
    process.stderr.write("token=CANARY_PLUGIN_SECRET\n");
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "contribution",
      requestId: message.requestId,
      payload: {
        kind: "synthetic",
        behavior: "fast",
        enforcementTier: message.payload.enforcementTier,
        resourceLimits: message.payload.resourceLimits,
      },
    })}\n`);
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "complete",
      requestId: message.requestId,
      payload: { count: 1 },
    })}\n`);
  }
}
