#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { once } from "node:events";

const PUBLIC_HOST = "boss-man.phase0.invalid";
const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`;
const OUTER_USER = "phase0-edge";
const OUTER_PASSWORD = "synthetic-outer-password";
const OWNER_PASSPHRASE = "synthetic-owner-passphrase";
const EDGE_TOKEN = crypto.randomBytes(32).toString("hex");
const MAX_UPLOAD_BYTES = 64 * 1024;
const REMOTE_CLIENT_IP = "198.51.100.10";
const LAN_CLIENT_IP = "192.0.2.10";
const startedAt = new Date();

const sessions = new Map();
const artifacts = new Map();
const terminalSequences = new Map();

function json(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": body.length,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(body);
}

function readBody(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseCookies(value = "") {
  return Object.fromEntries(
    value
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return separator < 0
          ? [entry, ""]
          : [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
}

function ownerSession(req) {
  const id = parseCookies(req.headers.cookie)["__Host-bm_session"];
  return id ? sessions.get(id) : undefined;
}

function validOrigin(req) {
  return !req.headers.origin || req.headers.origin === PUBLIC_ORIGIN;
}

function forwardedHeadersAreControlled(req) {
  return (
    req.headers.host === PUBLIC_HOST &&
    req.headers["x-forwarded-host"] === PUBLIC_HOST &&
    req.headers["x-forwarded-proto"] === "https" &&
    [REMOTE_CLIENT_IP, LAN_CLIENT_IP].includes(req.headers["x-forwarded-for"]) &&
    !req.headers.forwarded
  );
}

function trustedEdge(req) {
  return (
    req.headers["x-phase0-edge-token"] === EDGE_TOKEN &&
    forwardedHeadersAreControlled(req)
  );
}

function requireOwner(req, res) {
  const session = ownerSession(req);
  if (!session) {
    json(res, 401, { error: "owner_session_required" });
    return undefined;
  }
  return session;
}

function requireCsrf(req, res, session) {
  if (
    req.headers.origin !== PUBLIC_ORIGIN ||
    req.headers["x-csrf-token"] !== session.csrf
  ) {
    json(res, 403, { error: "csrf_rejected" });
    return false;
  }
  return true;
}

const origin = http.createServer(async (req, res) => {
  try {
    if (!trustedEdge(req)) {
      json(res, 403, { error: "trusted_proxy_required" });
      return;
    }
    if (!validOrigin(req)) {
      json(res, 403, { error: "origin_rejected" });
      return;
    }

    const url = new URL(req.url, PUBLIC_ORIGIN);
    if (req.method === "POST" && url.pathname === "/api/session/login") {
      const body = JSON.parse((await readBody(req, 4096)).toString("utf8"));
      if (body.passphrase !== OWNER_PASSPHRASE) {
        json(res, 401, { error: "invalid_owner_credentials" });
        return;
      }
      const id = crypto.randomBytes(24).toString("base64url");
      const csrf = crypto.randomBytes(24).toString("base64url");
      sessions.set(id, { csrf, createdAt: Date.now() });
      json(
        res,
        201,
        { csrf_token: csrf, external_url: `${PUBLIC_ORIGIN}/` },
        {
          "set-cookie": `__Host-bm_session=${id}; Path=/; Secure; HttpOnly; SameSite=Strict`,
        },
      );
      return;
    }

    const session = requireOwner(req, res);
    if (!session) return;

    if (req.method === "GET" && url.pathname === "/api/session") {
      json(res, 200, { authenticated: true, external_url: `${PUBLIC_ORIGIN}/` });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/headers") {
      json(res, 200, {
        host: req.headers.host,
        forwarded_host: req.headers["x-forwarded-host"],
        forwarded_proto: req.headers["x-forwarded-proto"],
        forwarded_for: req.headers["x-forwarded-for"],
        forwarded_standard_present: Boolean(req.headers.forwarded),
        external_url: `${PUBLIC_ORIGIN}/tasks/example`,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write('event: status\ndata: {"sequence":1}\n\n');
      setTimeout(() => res.write('event: status\ndata: {"sequence":2}\n\n'), 90);
      setTimeout(() => {
        res.write('event: status\ndata: {"sequence":3}\n\n');
        res.end();
      }, 180);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/artifacts") {
      if (!requireCsrf(req, res, session)) return;
      const body = await readBody(req);
      const id = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
      artifacts.set(id, body);
      json(res, 201, {
        artifact_id: id,
        size: body.length,
        sha256: crypto.createHash("sha256").update(body).digest("hex"),
      });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/artifacts/")) {
      const id = url.pathname.split("/").at(-1);
      const artifact = artifacts.get(id);
      if (!artifact) {
        json(res, 404, { error: "artifact_not_found" });
        return;
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": artifact.length,
        "content-disposition": `attachment; filename="${id}.bin"`,
      });
      res.end(artifact);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session/revoke") {
      if (!requireCsrf(req, res, session)) return;
      const id = parseCookies(req.headers.cookie)["__Host-bm_session"];
      sessions.delete(id);
      res.writeHead(204, {
        "set-cookie": "__Host-bm_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
        "cache-control": "no-store",
      });
      res.end();
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    if (!res.headersSent) {
      json(res, error.statusCode ?? 500, { error: error.message });
    } else {
      res.destroy(error);
    }
  }
});

function socketResponse(socket, status, body) {
  const text = JSON.stringify({ error: body });
  socket.end(
    `HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`,
  );
}

function websocketFrame(text) {
  const body = Buffer.from(text);
  assert(body.length < 126, "phase0 frames use the short RFC6455 length form");
  return Buffer.concat([Buffer.from([0x81, body.length]), body]);
}

origin.on("upgrade", (req, socket) => {
  if (!trustedEdge(req)) return socketResponse(socket, "403 Forbidden", "trusted_proxy_required");
  if (!validOrigin(req)) return socketResponse(socket, "403 Forbidden", "origin_rejected");
  const session = ownerSession(req);
  if (!session) return socketResponse(socket, "401 Unauthorized", "owner_session_required");
  if (req.headers.origin !== PUBLIC_ORIGIN) {
    return socketResponse(socket, "403 Forbidden", "origin_rejected");
  }
  const url = new URL(req.url, PUBLIC_ORIGIN);
  if (url.pathname !== "/terminal") return socketResponse(socket, "404 Not Found", "not_found");
  const key = req.headers["sec-websocket-key"];
  if (!key) return socketResponse(socket, "400 Bad Request", "websocket_key_required");
  const terminalId = url.searchParams.get("terminal_id") ?? "default";
  const after = Number(url.searchParams.get("after") ?? "0");
  const previous = terminalSequences.get(terminalId) ?? 0;
  const sequence = Math.max(previous, Number.isFinite(after) ? after : 0) + 1;
  terminalSequences.set(terminalId, sequence);
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.write(websocketFrame(JSON.stringify({ terminal_id: terminalId, sequence })));
});

function outerAuthorizationValid(header = "") {
  const expected = `Basic ${Buffer.from(`${OUTER_USER}:${OUTER_PASSWORD}`).toString("base64")}`;
  const actual = Buffer.from(header);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

const forbiddenForwardingHeaders = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
];

function validateEdgeRequest(req, resOrSocket, requireOuter) {
  const reject = (status, error) => {
    if (resOrSocket instanceof http.ServerResponse) {
      json(resOrSocket, status, { error }, status === 401 ? { "www-authenticate": 'Basic realm="Boss Man edge"' } : {});
    } else {
      socketResponse(resOrSocket, status === 401 ? "401 Unauthorized" : `${status} Rejected`, error);
    }
    return false;
  };
  if (req.headers.host !== PUBLIC_HOST) return reject(421, "host_rejected");
  if (forbiddenForwardingHeaders.some((name) => req.headers[name] !== undefined)) {
    return reject(400, "client_forwarding_headers_rejected");
  }
  if (!validOrigin(req)) return reject(403, "origin_rejected");
  if (requireOuter && !outerAuthorizationValid(req.headers.authorization)) {
    return reject(401, "outer_basic_auth_required");
  }
  return true;
}

function controlledHeaders(req, clientIp) {
  const headers = {
    host: PUBLIC_HOST,
    "x-forwarded-host": PUBLIC_HOST,
    "x-forwarded-proto": "https",
    "x-forwarded-for": clientIp,
    "x-phase0-edge-token": EDGE_TOKEN,
  };
  for (const name of ["content-type", "content-length", "cookie", "origin", "x-csrf-token"]) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  }
  return headers;
}

function createEdge({ requireOuter, clientIp }) {
  const server = http.createServer((req, res) => {
    if (!validateEdgeRequest(req, res, requireOuter)) {
      req.resume();
      return;
    }
    const declaredLength = Number(req.headers["content-length"] ?? 0);
    if (declaredLength > MAX_UPLOAD_BYTES) {
      req.resume();
      json(res, 413, { error: "upload_limit_exceeded" });
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: origin.address().port,
        method: req.method,
        path: req.url,
        headers: controlledHeaders(req, clientIp),
      },
      (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
        upstreamResponse.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) json(res, 502, { error: error.message });
      else res.destroy(error);
    });
    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket) => {
    if (!validateEdgeRequest(req, socket, requireOuter)) return;
    const upstream = net.connect(origin.address().port, "127.0.0.1", () => {
      const headers = controlledHeaders(req, clientIp);
      headers.connection = "Upgrade";
      headers.upgrade = "websocket";
      headers["sec-websocket-key"] = req.headers["sec-websocket-key"];
      headers["sec-websocket-version"] = req.headers["sec-websocket-version"] ?? "13";
      const lines = [`GET ${req.url} HTTP/1.1`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), "", ""];
      upstream.write(lines.join("\r\n"));
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socketResponse(socket, "502 Bad Gateway", "origin_unavailable"));
  });
  return server;
}

const remoteEdge = createEdge({ requireOuter: true, clientIp: REMOTE_CLIENT_IP });
const lanEdge = createEdge({ requireOuter: false, clientIp: LAN_CLIENT_IP });
const openSockets = new Set();
for (const server of [origin, remoteEdge, lanEdge]) {
  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.once("close", () => openSockets.delete(socket));
  });
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function request(port, { method = "GET", path = "/api/session", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { host: PUBLIC_HOST, ...headers };
    if (body !== undefined && requestHeaders["content-length"] === undefined) {
      requestHeaders["content-length"] = Buffer.byteLength(body);
    }
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: requestHeaders }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: responseBody });
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("HTTP probe timed out")));
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

function streamRequest(port, headers) {
  return new Promise((resolve, reject) => {
    const began = performance.now();
    const arrivals = [];
    const chunks = [];
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/events", headers: { host: PUBLIC_HOST, ...headers } },
      (res) => {
        res.on("data", (chunk) => {
          arrivals.push(performance.now() - began);
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode, arrivals, body: Buffer.concat(chunks).toString("utf8"), ended: performance.now() - began }));
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("stream probe timed out")));
    req.end();
  });
}

function websocketRequest(port, { cookie, after, authorization = true, origin = PUBLIC_ORIGIN }) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const socket = net.connect(port, "127.0.0.1", () => {
      const headers = [
        `GET /terminal?terminal_id=term-phase0&after=${after} HTTP/1.1`,
        `Host: ${PUBLIC_HOST}`,
        `Origin: ${origin}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Key: ${key}`,
        `Cookie: ${cookie}`,
      ];
      if (authorization) {
        headers.push(`Authorization: Basic ${Buffer.from(`${OUTER_USER}:${OUTER_PASSWORD}`).toString("base64")}`);
      }
      socket.write(`${headers.join("\r\n")}\r\n\r\n`);
    });
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const boundary = buffer.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const head = buffer.subarray(0, boundary).toString("utf8");
      const status = Number(head.match(/^HTTP\/1\.1 (\d+)/)?.[1]);
      if (status !== 101) {
        socket.destroy();
        resolve({ status, payload: null });
        return;
      }
      const framed = buffer.subarray(boundary + 4);
      if (framed.length < 2) return;
      const length = framed[1] & 0x7f;
      if (framed.length < 2 + length) return;
      const payload = JSON.parse(framed.subarray(2, 2 + length).toString("utf8"));
      socket.destroy();
      resolve({ status, payload });
    });
    socket.on("error", reject);
    socket.setTimeout(2000, () => {
      socket.destroy();
      reject(new Error("WebSocket probe timed out"));
    });
  });
}

const assertions = [];
function record(name, observed, check) {
  assert(check, name);
  assertions.push({ name, passed: true, observed });
}

let remotePort;
let lanPort;
try {
  await listen(origin);
  remotePort = await listen(remoteEdge);
  lanPort = await listen(lanEdge);

  const outer = `Basic ${Buffer.from(`${OUTER_USER}:${OUTER_PASSWORD}`).toString("base64")}`;
  const noOuter = await request(remotePort);
  const outerOnly = await request(remotePort, { headers: { authorization: outer } });
  const lanWithoutOwner = await request(lanPort);
  record(
    "outer Basic Auth and independent inner owner session are both enforced",
    { remote_without_outer: noOuter.status, remote_with_outer_only: outerOnly.status, lan_bypass_without_owner: lanWithoutOwner.status },
    noOuter.status === 401 && outerOnly.status === 401 && lanWithoutOwner.status === 401,
  );

  const loginBody = JSON.stringify({ passphrase: OWNER_PASSPHRASE });
  const login = await request(remotePort, {
    method: "POST",
    path: "/api/session/login",
    headers: { authorization: outer, origin: PUBLIC_ORIGIN, "content-type": "application/json" },
    body: loginBody,
  });
  assert.equal(login.status, 201);
  const setCookie = Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"][0] : login.headers["set-cookie"];
  const cookie = setCookie.split(";", 1)[0];
  const loginResult = JSON.parse(login.body);
  const csrf = loginResult.csrf_token;
  record(
    "owner cookie is host-only, Secure, HttpOnly, and SameSite=Strict",
    { set_cookie_attributes: setCookie.split(";").slice(1).map((value) => value.trim()), cookie_name: cookie.split("=")[0] },
    /^__Host-bm_session=/.test(setCookie) && /; Path=\//.test(setCookie) && /; Secure/.test(setCookie) && /; HttpOnly/.test(setCookie) && /; SameSite=Strict/.test(setCookie) && !/; Domain=/i.test(setCookie),
  );

  const badHost = await request(remotePort, { headers: { host: "untrusted.invalid", authorization: outer } });
  const badOrigin = await request(remotePort, { headers: { authorization: outer, cookie, origin: "https://untrusted.invalid" } });
  const spoofedForwarding = await request(remotePort, { headers: { authorization: outer, cookie, "x-forwarded-for": "203.0.113.200" } });
  record(
    "untrusted Host, Origin, and client-supplied forwarding headers are rejected",
    { bad_host: badHost.status, bad_origin: badOrigin.status, spoofed_forwarding: spoofedForwarding.status },
    badHost.status === 421 && badOrigin.status === 403 && spoofedForwarding.status === 400,
  );

  const controlled = await request(remotePort, { path: "/api/headers", headers: { authorization: outer, cookie } });
  const controlledResult = JSON.parse(controlled.body);
  record(
    "proxy overwrites the controlled forwarding chain and origin uses configured external URL",
    controlledResult,
    controlled.status === 200 && controlledResult.host === PUBLIC_HOST && controlledResult.forwarded_host === PUBLIC_HOST && controlledResult.forwarded_proto === "https" && controlledResult.forwarded_for === REMOTE_CLIENT_IP && controlledResult.forwarded_standard_present === false && controlledResult.external_url === `${PUBLIC_ORIGIN}/tasks/example`,
  );

  const directOrigin = await request(origin.address().port, { path: "/api/session", headers: { cookie } });
  record(
    "origin denies requests that do not traverse the trusted edge contract",
    { direct_origin_status: directOrigin.status },
    directOrigin.status === 403,
  );

  const missingCsrf = await request(remotePort, {
    method: "POST",
    path: "/api/artifacts",
    headers: { authorization: outer, cookie, origin: PUBLIC_ORIGIN, "content-type": "application/octet-stream" },
    body: "mutation",
  });
  const badCsrf = await request(remotePort, {
    method: "POST",
    path: "/api/artifacts",
    headers: { authorization: outer, cookie, origin: PUBLIC_ORIGIN, "x-csrf-token": "wrong" },
    body: "mutation",
  });
  record(
    "state-changing requests reject missing or invalid CSRF proof",
    { missing_csrf: missingCsrf.status, invalid_csrf: badCsrf.status },
    missingCsrf.status === 403 && badCsrf.status === 403,
  );

  const firstSocket = await websocketRequest(remotePort, { cookie, after: 0 });
  const secondSocket = await websocketRequest(remotePort, { cookie, after: firstSocket.payload.sequence });
  record(
    "authorized terminal WebSocket reconnect preserves terminal identity and advances sequence",
    { first: firstSocket, reconnect: secondSocket },
    firstSocket.status === 101 && secondSocket.status === 101 && firstSocket.payload.terminal_id === "term-phase0" && secondSocket.payload.terminal_id === "term-phase0" && secondSocket.payload.sequence === firstSocket.payload.sequence + 1,
  );

  const stream = await streamRequest(remotePort, { authorization: outer, cookie });
  const sequences = [...stream.body.matchAll(/"sequence":(\d+)/g)].map((match) => Number(match[1]));
  const spreadMs = stream.arrivals.at(-1) - stream.arrivals[0];
  record(
    "structured event stream is forwarded incrementally without response buffering",
    { sequences, chunk_arrivals_ms: stream.arrivals.map(Math.round), response_end_ms: Math.round(stream.ended), arrival_spread_ms: Math.round(spreadMs) },
    stream.status === 200 && sequences.join(",") === "1,2,3" && stream.arrivals.length >= 3 && spreadMs >= 120 && stream.ended - stream.arrivals[0] >= 120,
  );

  const artifactBytes = Buffer.from("Boss Man Phase 0 artifact transfer\n".repeat(200));
  const upload = await request(remotePort, {
    method: "POST",
    path: "/api/artifacts",
    headers: { authorization: outer, cookie, origin: PUBLIC_ORIGIN, "x-csrf-token": csrf, "content-type": "application/octet-stream" },
    body: artifactBytes,
  });
  const uploadResult = JSON.parse(upload.body);
  const download = await request(remotePort, {
    path: `/api/artifacts/${uploadResult.artifact_id}`,
    headers: { authorization: outer, cookie },
  });
  const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61);
  const oversizedUpload = await request(remotePort, {
    method: "POST",
    path: "/api/artifacts",
    headers: { authorization: outer, cookie, origin: PUBLIC_ORIGIN, "x-csrf-token": csrf, "content-type": "application/octet-stream" },
    body: oversized,
  });
  const artifactHash = crypto.createHash("sha256").update(artifactBytes).digest("hex");
  record(
    "bounded upload and checksum-preserving artifact download work through the edge",
    { accepted_size: uploadResult.size, accepted_sha256: uploadResult.sha256, downloaded_sha256: crypto.createHash("sha256").update(download.body).digest("hex"), upload_limit_bytes: MAX_UPLOAD_BYTES, oversized_status: oversizedUpload.status },
    upload.status === 201 && download.status === 200 && uploadResult.size === artifactBytes.length && uploadResult.sha256 === artifactHash && download.body.equals(artifactBytes) && oversizedUpload.status === 413,
  );

  const revoke = await request(remotePort, {
    method: "POST",
    path: "/api/session/revoke",
    headers: { authorization: outer, cookie, origin: PUBLIC_ORIGIN, "x-csrf-token": csrf },
  });
  const afterRevoke = await request(remotePort, { headers: { authorization: outer, cookie } });
  const socketAfterRevoke = await websocketRequest(remotePort, { cookie, after: secondSocket.payload.sequence });
  record(
    "revocation invalidates the owner session for HTTP and terminal WebSocket access",
    { revoke_status: revoke.status, http_after_revoke: afterRevoke.status, websocket_after_revoke: socketAfterRevoke.status, clearing_cookie: revoke.headers["set-cookie"] },
    revoke.status === 204 && afterRevoke.status === 401 && socketAfterRevoke.status === 401 && String(revoke.headers["set-cookie"]).includes("Max-Age=0"),
  );

  console.log(
    JSON.stringify(
      {
        started_at: startedAt.toISOString(),
        ended_at: new Date().toISOString(),
        node: process.version,
        host: { os: `${os.type()} ${os.release()}`, architecture: os.arch() },
        public_origin: PUBLIC_ORIGIN,
        transport: "disposable loopback HTTP simulating TLS termination at SWAG",
        outer_policy: { remote_requires_basic: true, lan_bypasses_basic: true },
        upload_limit_bytes: MAX_UPLOAD_BYTES,
        assertions,
      },
      null,
      2,
    ),
  );
} finally {
  for (const socket of openSockets) socket.destroy();
  await Promise.all(
    [remoteEdge, lanEdge, origin].map(
      (server) => new Promise((resolve) => server.listening ? server.close(resolve) : resolve()),
    ),
  );
}
