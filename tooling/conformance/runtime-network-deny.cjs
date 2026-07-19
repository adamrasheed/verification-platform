"use strict";

const { syncBuiltinESMExports } = require("node:module");

function denied(operation) {
  return function runtimeNetworkDenied() {
    const error = new Error(`VFY_RUNTIME_NETWORK_DENIED:${operation}`);
    error.code = "VFY_RUNTIME_NETWORK_DENIED";
    throw error;
  };
}

for (const moduleName of [
  "node:net",
  "node:tls",
  "node:dgram",
  "node:dns",
  "node:http",
  "node:https",
  "node:http2",
]) {
  const target = require(moduleName);
  for (const method of [
    "connect",
    "createConnection",
    "createSocket",
    "lookup",
    "lookupService",
    "resolve",
    "resolve4",
    "resolve6",
    "resolveAny",
    "resolveCaa",
    "resolveCname",
    "resolveMx",
    "resolveNaptr",
    "resolveNs",
    "resolvePtr",
    "resolveSoa",
    "resolveSrv",
    "resolveTxt",
    "reverse",
    "request",
    "get",
  ]) {
    if (typeof target[method] === "function") {
      target[method] = denied(`${moduleName}.${method}`);
    }
  }
  if (target.Socket?.prototype?.connect !== undefined) {
    target.Socket.prototype.connect = denied(`${moduleName}.Socket.connect`);
  }
}

globalThis.fetch = denied("global.fetch");
syncBuiltinESMExports();
