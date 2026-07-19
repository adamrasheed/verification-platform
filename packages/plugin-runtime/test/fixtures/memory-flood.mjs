import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });
const retained = [];

for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.messageType === "handshake.request") {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "handshake.response",
      requestId: message.requestId,
      payload: {
        pluginId: "synthetic-memory-flood",
        selectedVersion: { major: 1, minor: 0 },
      },
    })}\n`);
  }
  if (message.messageType === "operation.request") {
    while (true) retained.push(Buffer.alloc(8 * 1024 * 1024, 0x41));
  }
}
