import childProcess from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });

function attempt(action) {
  try {
    action();
    return "ALLOWED";
  } catch (error) {
    return error?.code ?? "DENIED";
  }
}

async function subprocessAttempt(executable, arguments_) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = childProcess.spawn(executable, arguments_, {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (error) {
      resolve(error?.code ?? "DENIED");
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish("TIMEOUT");
    }, 1000);
    child.once("error", (error) => finish(error.code ?? "DENIED"));
    child.once("close", (code) => finish(code === 0 ? "ALLOWED" : `EXIT_${code}`));
  });
}

async function networkAttempt() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "1.1.1.1", port: 443 });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve("TIMEOUT");
    }, 1000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve("ALLOWED");
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      resolve(error.code ?? "DENIED");
    });
  });
}

for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.messageType === "handshake.request") {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "handshake.response",
      requestId: message.requestId,
      payload: {
        pluginId: "synthetic-sandbox",
        selectedVersion: { major: 1, minor: 0 },
      },
    })}\n`);
  }
  if (message.messageType === "operation.request") {
    const protectedFile = process.platform === "win32"
      ? "C:\\Windows\\System32\\config\\SAM"
      : "/etc/hosts";
    const echo = process.platform === "win32"
      ? ["C:\\Windows\\System32\\cmd.exe", ["/d", "/c", "echo unsafe"]]
      : ["/bin/echo", ["unsafe"]];
    const filesystem = attempt(() => fs.readFileSync(protectedFile));
    const subprocess = await subprocessAttempt(echo[0], echo[1]);
    const network = await networkAttempt();
    const result = { filesystem, subprocess, network };
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "contribution",
      requestId: message.requestId,
      payload: result,
    })}\n`);
    process.stdout.write(`${JSON.stringify({
      protocolVersion: "1.0",
      messageType: "complete",
      requestId: message.requestId,
      payload: {},
    })}\n`);
  }
  if (message.messageType === "cancel.request") process.exit(0);
}
