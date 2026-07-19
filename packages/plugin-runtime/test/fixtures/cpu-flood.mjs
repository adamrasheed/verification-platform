import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });

for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.messageType === "handshake.request") {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "handshake.response",
      requestId: message.requestId,
      payload: {
        pluginId: "synthetic-cpu-flood",
        selectedVersion: { major: 1, minor: 0 },
      },
    })}\n`);
  }
  if (message.messageType === "operation.request") {
    while (true) {
      // Deliberately consume the supervised process's CPU budget.
    }
  }
}
