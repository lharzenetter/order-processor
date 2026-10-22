import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeArchive } from "./archive.ts";
import {
  isReplaceReason,
  openLogStore,
  type LogHead,
  type LogStore,
  type StoredEvent,
} from "./log-store.ts";

export interface SyncServerOptions {
  readonly pairingCode: string;
  readonly allowedOrigin: string;
  /** Holds kirbe.sqlite and archive/. */
  readonly dataDir: string;
  /** The certificate's notAfter in ms, read on each GET /log; null when unknown. */
  readonly certExpiresAt: () => number | null;
  /** Where log lines go (default console.log); tests capture it. Never gets the code or a query string. */
  readonly log?: (line: string) => void;
}

export interface SyncServer {
  handle(request: Request): Promise<Response>;
  /** Closes SQLite, ends open streams and stops their pings. */
  close(): void;
}

const PING_INTERVAL_MS = 10_000;
const PREFLIGHT_MAX_AGE_MS = 86_400_000;

// A browser EventSource never surfaces SSE comments, so the iPad's 25 s watchdog could not see a
// bare `: ping`. The comment stays for proxies and curl; the named `ping` event is what the iPad
// observes (server-sync 02, "Live channel on the iPad").
const PING = ": ping\nevent: ping\ndata: \n\n";

const ENCODER = new TextEncoder();

interface StreamClient {
  send(chunk: string): void;
  end(): void;
}

type Body = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isWholeNumber(value: unknown): value is number {
  return Number.isInteger(value);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function status(code: number): Response {
  return new Response(null, { status: code });
}

function conflict(head: LogHead): Response {
  return json(409, { logId: head.logId, lastSeq: head.lastSeq });
}

async function readJson(
  request: Request,
): Promise<{ readonly value: unknown } | undefined> {
  try {
    const value: unknown = await request.json();
    return { value };
  } catch {
    return undefined;
  }
}

/** An event the server can order: an object with a string `id` and a whole-number `seq`. */
function storable(value: unknown): StoredEvent | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isWholeNumber(value.seq)
  ) {
    return undefined;
  }
  return { id: value.id, seq: value.seq, json: JSON.stringify(value) };
}

// server-sync 02: the server checks shape only. `seq` runs 1..n and ids are unique.
function storableLog(values: readonly unknown[]): StoredEvent[] | undefined {
  const events: StoredEvent[] = [];
  const ids = new Set<string>();
  for (const [index, value] of values.entries()) {
    const event = storable(value);
    if (event?.seq !== index + 1 || ids.has(event.id)) return undefined;
    ids.add(event.id);
    events.push(event);
  }
  return events;
}

function logMessage(head: LogHead): string {
  const data = {
    logId: head.logId,
    previousLogId: head.previousLogId,
    lastSeq: head.lastSeq,
    device: head.device,
    reason: head.reason,
  };
  return `event: log\ndata: ${JSON.stringify(data)}\n\n`;
}

function appendedMessage(event: StoredEvent): string {
  return `event: appended\nid: ${String(event.seq)}\ndata: ${event.json}\n\n`;
}

function digest(code: string): Buffer {
  return createHash("sha256").update(code).digest();
}

export function createSyncServer(options: SyncServerOptions): SyncServer {
  const log = options.log ?? console.log;
  mkdirSync(options.dataDir, { recursive: true });
  const store: LogStore = openLogStore(join(options.dataDir, "kirbe.sqlite"));
  const archiveDir = join(options.dataDir, "archive");
  const clients = new Set<StreamClient>();
  const expectedCode = digest(options.pairingCode);
  let closed = false;

  // Equal-length digests let timingSafeEqual compare in constant time without leaking the code's
  // length or contents.
  function codeMatches(given: string | null): boolean {
    return given !== null && timingSafeEqual(digest(given), expectedCode);
  }

  function broadcast(chunk: string): void {
    for (const client of [...clients]) client.send(chunk);
  }

  function getLog(): Response {
    const head = store.head();
    return json(200, {
      logId: head.logId,
      formatVersion: head.formatVersion,
      lastSeq: head.lastSeq,
      ids: store.ids(),
      certExpiresAt: options.certExpiresAt(),
    });
  }

  function getEvents(url: URL): Response {
    const after = url.searchParams.get("after") ?? "0";
    if (!/^\d+$/.test(after)) return status(400);
    // The stored text goes out as received, so the iPad reads back exactly what was stamped.
    const body = `[${store.eventsAfter(Number(after)).join(",")}]`;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // server-sync 02: the checks run in this order, so a retry of a tap that landed gets its 201.
  async function postEvent(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (
      body === undefined ||
      !isRecord(body.value) ||
      typeof body.value.logId !== "string"
    ) {
      return status(400);
    }
    const event = storable(body.value.event);
    if (event === undefined) return status(400);
    const head = store.head();
    if (body.value.logId !== head.logId) return conflict(head);
    const knownSeq = store.seqOf(event.id);
    if (knownSeq !== undefined) return json(201, { seq: knownSeq });
    if (event.seq !== head.lastSeq + 1) return conflict(head);
    store.append(event);
    broadcast(appendedMessage(event));
    return json(201, { seq: event.seq });
  }

  async function putLog(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (body === undefined || !isRecord(body.value)) return status(400);
    const { ifLogId, formatVersion, events, device, reason } = body.value;
    if (
      typeof ifLogId !== "string" ||
      !isWholeNumber(formatVersion) ||
      formatVersion < 1 ||
      typeof device !== "string" ||
      !isReplaceReason(reason) ||
      !isArray(events)
    ) {
      return status(400);
    }
    const stored = storableLog(events);
    if (stored === undefined) return status(400);
    const head = store.head();
    if (ifLogId !== head.logId) return conflict(head);
    const logId = store.replace(
      { formatVersion, device, reason, events: stored },
      (old) => {
        writeArchive(archiveDir, Date.now(), old);
      },
    );
    broadcast(logMessage(store.head()));
    return json(200, { logId });
  }

  function openStream(request: Request): Response {
    let stop = (): void => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let ended = false;
        const client: StreamClient = {
          send(chunk) {
            if (!ended) controller.enqueue(ENCODER.encode(chunk));
          },
          end() {
            if (ended) return;
            stop();
            controller.close();
          },
        };
        const ping = setInterval(() => {
          client.send(PING);
        }, PING_INTERVAL_MS);
        function onAbort(): void {
          client.end();
        }
        stop = () => {
          ended = true;
          clearInterval(ping);
          clients.delete(client);
          request.signal.removeEventListener("abort", onAbort);
        };
        clients.add(client);
        request.signal.addEventListener("abort", onAbort);
        client.send(logMessage(store.head()));
        if (request.signal.aborted) client.end();
      },
      cancel() {
        stop();
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      },
    });
  }

  function preflight(origin: string | null): Response {
    if (origin !== options.allowedOrigin) return status(403);
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, PUT",
        "Access-Control-Allow-Headers": "Content-Type, X-Pairing-Code",
        "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_MS / 1_000),
      },
    });
  }

  async function route(request: Request, url: URL): Promise<Response> {
    if (request.method === "OPTIONS")
      return preflight(request.headers.get("Origin"));
    const headerCode = request.headers.get("X-Pairing-Code");
    const endpoint = `${request.method} ${url.pathname}`;
    // EventSource sends no headers, so the stream alone takes the code from the query.
    if (endpoint === "GET /log/stream") {
      const code = headerCode ?? url.searchParams.get("code");
      return codeMatches(code) ? openStream(request) : status(401);
    }
    const handlers: Readonly<
      Record<string, () => Response | Promise<Response>>
    > = {
      "GET /log": getLog,
      "GET /log/events": () => getEvents(url),
      "POST /log/events": () => postEvent(request),
      "PUT /log": () => putLog(request),
    };
    const handler = handlers[endpoint];
    if (handler === undefined) return status(404);
    if (!codeMatches(headerCode)) return status(401);
    return handler();
  }

  return {
    async handle(request) {
      const url = new URL(request.url);
      const response = await route(request, url);
      if (request.headers.get("Origin") === options.allowedOrigin) {
        response.headers.set(
          "Access-Control-Allow-Origin",
          options.allowedOrigin,
        );
        response.headers.set("Vary", "Origin");
      }
      // Never the query string: the stream carries the pairing code there.
      log(`${request.method} ${url.pathname} ${String(response.status)}`);
      return response;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const client of [...clients]) client.end();
      store.close();
    },
  };
}
