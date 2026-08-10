import { Readable } from "node:stream";

const SINGLETON_HEADERS = new Set([
  "authorization",
  "content-encoding",
  "content-length",
  "content-type",
  "idempotency-key",
]);

function checkedHeaders(request) {
  const headers = new Headers();
  const occurrences = new Map();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]?.toLowerCase();
    const value = request.rawHeaders[index + 1];
    if (!name || value === undefined) throw new TypeError("malformed HTTP headers");
    const count = (occurrences.get(name) ?? 0) + 1;
    occurrences.set(name, count);
    if (SINGLETON_HEADERS.has(name) && count !== 1) {
      throw new TypeError("duplicate singleton HTTP header");
    }
    headers.append(name, value);
  }
  return headers;
}

function controlRequest(request, origin) {
  if (!request.method || !request.url || !request.url.startsWith("/")) {
    throw new TypeError("malformed HTTP request target");
  }
  const method = request.method.toUpperCase();
  const init = { method, headers: checkedHeaders(request) };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }
  return new Request(new URL(request.url, origin), init);
}

async function writeResponse(response, target) {
  target.statusCode = response.status;
  for (const [name, value] of response.headers) target.setHeader(name, value);
  target.end(Buffer.from(await response.arrayBuffer()));
}

function failure(target, status, code) {
  target.statusCode = status;
  target.setHeader("cache-control", "no-store");
  target.setHeader("content-type", "application/json; charset=utf-8");
  target.setHeader("x-content-type-options", "nosniff");
  target.end(JSON.stringify({ error: { code } }));
}

export function createControlApiNodeListener(handler, options = {}) {
  const origin = new URL(options.origin ?? "http://127.0.0.1").origin;
  return (request, response) => {
    void (async () => {
      let translated;
      try {
        translated = controlRequest(request, origin);
      } catch {
        failure(response, 400, "VFY_CONTROL_API_HTTP_INVALID");
        return;
      }
      try {
        await writeResponse(await handler(translated), response);
      } catch {
        if (!response.headersSent) failure(response, 500, "VFY_CONTROL_API_INTERNAL");
        else response.destroy();
      }
    })();
  };
}
