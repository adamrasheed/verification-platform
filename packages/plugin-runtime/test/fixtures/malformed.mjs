process.stdin.once("data", () => {
  process.stdout.write(
    '{"protocolVersion":"1.0","messageType":"handshake.response","requestId":"x","requestId":"y","payload":{}}\n',
  );
});
