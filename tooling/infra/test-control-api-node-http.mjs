import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as rawRequest } from "node:http";
import test from "node:test";
import { createControlApiNodeListener } from "./control-api-node-http.mjs";

async function serverFor(handler) {
  const server = createServer(createControlApiNodeListener(handler));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

test("Node listener preserves the bounded Fetch request and response boundary", async () => {
  const seen = [];
  const { server, origin } = await serverFor(async (request) => {
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: await request.text(),
      authorization: request.headers.get("authorization"),
    });
    return new Response('{"ok":true}', {
      status: 201,
      headers: { "content-type": "application/json", "x-test": "passed" },
    });
  });
  try {
    const response = await fetch(`${origin}/v1/test`, {
      method: "POST",
      headers: { authorization: "Bearer safe", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-test"), "passed");
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(seen, [{
      method: "POST",
      path: "/v1/test",
      body: "{}",
      authorization: "Bearer safe",
    }]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Node listener rejects duplicate security headers before the handler", async () => {
  let calls = 0;
  const { server, origin } = await serverFor(async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  });
  try {
    const url = new URL(origin);
    const response = await new Promise((resolve, reject) => {
      const request = rawRequest({
        host: url.hostname,
        port: url.port,
        path: "/v1/test",
        headers: ["Authorization", "Bearer one", "Authorization", "Bearer two"],
      }, (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("end", () => resolve({ status: incoming.statusCode }));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Node listener hides unexpected handler failures behind a server error", async () => {
  const { server, origin } = await serverFor(async () => {
    throw new Error("database contains secret context");
  });
  try {
    const response = await fetch(`${origin}/v1/test`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { code: "VFY_CONTROL_API_INTERNAL" },
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});
