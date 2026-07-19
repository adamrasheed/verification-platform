import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.messageType === "handshake.request") {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "handshake.response",
      requestId: message.requestId,
      payload: { selectedVersion: { major: 1, minor: 0 }, pluginId: "synthetic-slow" },
    })}\n`);
  } else if (message.messageType === "operation.request") {
    setTimeout(() => {
      process.stdout.write(`${JSON.stringify({
        protocolVersion: "1.0",
        messageType: "complete",
        requestId: message.requestId,
        payload: {},
      })}\n`);
    }, 10_000);
  }
}
