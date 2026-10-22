import { X509Certificate } from "node:crypto";
import { readFileSync, unwatchFile, watchFile } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import { buffer } from "node:stream/consumers";
import { readConfig } from "./config.ts";
import { createSyncServer } from "./index.ts";

// The only file that reads process.env and listens; everything it wires up is tested on its own.

// The handler reads only the path and query, so the Host header never has to parse.
const URL_BASE = "https://localhost";
// An import of a whole Fest is far below this; anything larger is not an iPad.
const MAX_BODY_BYTES = 32 * 1024 * 1024;
// Polling, unlike fs.watch, survives lego replacing the files and works through a bind mount.
const CERT_POLL_INTERVAL_MS = 5_000;

function certificateExpiry(cert: Buffer): number {
  return new X509Certificate(cert).validToDate.getTime();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(problems: readonly string[]): never {
  console.error("The sync server cannot start:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

const result = readConfig(process.env, (path) => readFileSync(path));
if (!result.ok) fail(result.problems);
const config = result.config;

let certExpiresAt: number | null = null;
try {
  certExpiresAt = certificateExpiry(config.cert);
} catch (error) {
  fail([`CERT_FILE is not a PEM certificate: ${describe(error)}.`]);
}

const sync = createSyncServer({
  pairingCode: config.pairingCode,
  allowedOrigin: config.allowedOrigin,
  dataDir: config.dataDir,
  certExpiresAt: () => certExpiresAt,
});

function toHeaders(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value])
      headers.append(name, item);
  }
  return headers;
}

async function toRequest(
  message: IncomingMessage,
  signal: AbortSignal,
): Promise<Request> {
  const method = message.method ?? "GET";
  const init: RequestInit = { method, headers: toHeaders(message), signal };
  if (method !== "GET" && method !== "HEAD") init.body = await buffer(message);
  return new Request(new URL(message.url ?? "/", URL_BASE), init);
}

// Streams the body chunk by chunk, so every SSE message reaches the iPad as it is sent.
async function writeResponse(
  response: Response,
  reply: ServerResponse,
): Promise<void> {
  reply.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) {
    reply.end();
    return;
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  reply.on("close", () => {
    void reader.cancel();
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      reply.write(value);
    }
  } finally {
    reply.end();
  }
}

async function serve(
  message: IncomingMessage,
  reply: ServerResponse,
): Promise<void> {
  const disconnected = new AbortController();
  reply.on("close", () => {
    disconnected.abort();
  });
  try {
    if (Number(message.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
      reply.writeHead(413).end();
      return;
    }
    const response = await sync.handle(
      await toRequest(message, disconnected.signal),
    );
    await writeResponse(response, reply);
  } catch (error) {
    // Never the URL: the stream carries the pairing code in its query.
    console.error(`${message.method ?? "?"} failed: ${describe(error)}`);
    if (!reply.headersSent) reply.writeHead(500);
    reply.end();
  }
}

const server = createServer(
  { cert: config.cert, key: config.key },
  (message, reply) => {
    void serve(message, reply);
  },
);

// lego renews the certificate in place; the new one takes over without a restart.
function reloadCertificate(): void {
  try {
    const cert = readFileSync(config.certFile);
    const key = readFileSync(config.keyFile);
    server.setSecureContext({ cert, key });
    certExpiresAt = certificateExpiry(cert);
    console.log(
      `Reloaded the certificate, valid until ${new Date(certExpiresAt).toISOString()}.`,
    );
  } catch (error) {
    // Cert and key are written one after the other; the second change brings a matching pair.
    console.error(`Kept the previous certificate: ${describe(error)}`);
  }
}

for (const file of [config.certFile, config.keyFile]) {
  watchFile(file, { interval: CERT_POLL_INTERVAL_MS }, reloadCertificate);
}

function shutDown(): void {
  for (const file of [config.certFile, config.keyFile]) unwatchFile(file);
  sync.close();
  server.close(() => process.exit(0));
  server.closeAllConnections();
}

process.on("SIGTERM", shutDown);
process.on("SIGINT", shutDown);

server.listen(config.port, () => {
  console.log(`Sync server listening on port ${String(config.port)}.`);
});
