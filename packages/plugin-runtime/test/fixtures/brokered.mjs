import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.messageType === "handshake.request") {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "handshake.response",
      requestId: message.requestId,
      payload: { selectedVersion: { major: 1, minor: 0 }, pluginId: "synthetic-brokered" },
    })}\n`);
  } else if (message.messageType === "operation.request") {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "provider.request",
      requestId: message.requestId,
      payload: {
        providerRequestId: "provider:1",
        destinationId: "api",
        method: "GET",
        pathTemplateId: "repository-policy",
        pathParameters: {},
        outboundSchemaId: "repository-policy.v1",
        classification: "MINIMAL_METADATA",
        body: { repositoryBinding: "opaque:repository" },
        secretReferenceId: "secret:provider",
      },
    })}\n`);
  } else if (message.messageType === "provider.response") {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "contribution",
      requestId: message.requestId,
      payload: { kind: "synthetic", behavior: "brokered", observed: message.payload.body },
    })}\n`);
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "complete",
      requestId: message.requestId,
      payload: { count: 1 },
    })}\n`);
  }
}
