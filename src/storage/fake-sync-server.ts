import { isRecord } from "./guards";
import type { SyncStream, StreamMessage } from "./server-log";

/**
 * A stateful in-memory double of the sync server for tests: it re-implements the protocol rules
 * (server-sync 02) and has switches for the failures the real network has. The `contract/` suite
 * keeps it honest against the real `server/`.
 */
export interface FakeSyncServer {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly openStream: (url: string) => SyncStream;
  /** The stored events, as appended. */
  readonly events: readonly unknown[];
  readonly logId: string;
  /** How many requests reached the server, by `METHOD path`. */
  requests(route: string): number;
  /** The next `times` requests to `route` are handled, but their replies never arrive. */
  dropNextReply(route: string, times?: number): void;
  /** The next request to `route` is answered only after `ms`. */
  delayNextReply(route: string, ms: number): void;
  /** Streams stay open but receive nothing, pings included. */
  goSilent(): void;
  /** Every request fails as if the server were unreachable, and open streams error. */
  goOffline(): void;
  /** Undoes `goSilent` and `goOffline`. */
  comeBack(): void;
  /** Replaces the log as `PUT /log` does, as another iPad would. */
  replace(
    events: readonly unknown[],
    device: string,
    reason: string,
    formatVersion?: number,
  ): void;
  /** Appends as another iPad would. */
  appendFromOtherIpad(event: object): void;
}

export const FAKE_PING_EVERY_MS = 10_000;

interface Replacement {
  readonly previousLogId: string | null;
  readonly device: string | null;
  readonly reason: string | null;
}

interface FakeStream extends SyncStream {
  emit(type: string, data: string, id?: string): void;
  fail(): void;
}

export function createFakeSyncServer(
  options: { readonly pairingCode?: string; readonly logId?: string } = {},
): FakeSyncServer {
  const pairingCode = options.pairingCode ?? "ABCD2345";
  let events: Readonly<Record<string, unknown>>[] = [];
  let logId = options.logId ?? "log-1";
  let logCount = 1;
  let formatVersion: number | null = null;
  let replacement: Replacement = {
    previousLogId: null,
    device: null,
    reason: null,
  };
  let silent = false;
  let offline = false;
  const streams = new Set<FakeStream>();
  const counts = new Map<string, number>();
  const drops = new Map<string, number>();
  const delays = new Map<string, number>();
  let pinger: ReturnType<typeof setInterval> | null = null;

  function lastSeq(): number {
    return events.length;
  }

  function logMessage(): string {
    return JSON.stringify({ logId, lastSeq: lastSeq(), ...replacement });
  }

  function broadcast(type: string, data: string, id?: string): void {
    if (silent) {
      return;
    }
    for (const stream of streams) {
      stream.emit(type, data, id);
    }
  }

  function json(status: number, body: unknown): Response {
    return Response.json(body, { status });
  }

  function replaceLog(
    next: readonly Readonly<Record<string, unknown>>[],
    device: string,
    reason: string,
    version: number,
  ): void {
    const previousLogId = logId;
    events = [...next];
    formatVersion = version;
    logCount += 1;
    logId = `log-${String(logCount)}`;
    replacement = { previousLogId, device, reason };
    broadcast("log", logMessage());
  }

  function append(event: Readonly<Record<string, unknown>>): number {
    events.push(event);
    broadcast("appended", JSON.stringify(event), String(lastSeq()));
    return lastSeq();
  }

  function handle(method: string, url: URL, body: unknown): Response {
    switch (`${method} ${url.pathname}`) {
      case "GET /log":
        return json(200, {
          logId,
          formatVersion,
          lastSeq: lastSeq(),
          ids: events.map((event) => event.id),
          certExpiresAt: null,
        });
      case "GET /log/events": {
        const after = Number(url.searchParams.get("after") ?? "0");
        return json(200, events.slice(after));
      }
      case "POST /log/events": {
        if (
          !isRecord(body) ||
          !isRecord(body.event) ||
          typeof body.event.id !== "string" ||
          !Number.isInteger(body.event.seq)
        ) {
          return json(400, { error: "shape" });
        }
        if (body.logId !== logId) {
          return json(409, { logId, lastSeq: lastSeq() });
        }
        const event = body.event;
        const known = events.findIndex((e) => e.id === event.id);
        if (known !== -1) {
          return json(201, { seq: known + 1 });
        }
        if (event.seq !== lastSeq() + 1) {
          return json(409, { logId, lastSeq: lastSeq() });
        }
        return json(201, { seq: append(event) });
      }
      case "PUT /log": {
        if (
          !isRecord(body) ||
          !Array.isArray(body.events) ||
          typeof body.device !== "string" ||
          typeof body.reason !== "string" ||
          typeof body.formatVersion !== "number"
        ) {
          return json(400, { error: "shape" });
        }
        if (body.ifLogId !== logId) {
          return json(409, { logId, lastSeq: lastSeq() });
        }
        const next: unknown[] = body.events;
        const valid = next.filter(isRecord);
        if (
          valid.length !== next.length ||
          valid.some((event, index) => event.seq !== index + 1) ||
          new Set(valid.map((event) => event.id)).size !== valid.length
        ) {
          return json(400, { error: "shape" });
        }
        replaceLog(valid, body.device, body.reason, body.formatVersion);
        return json(200, { logId });
      }
      default:
        return json(404, { error: "not found" });
    }
  }

  function startPings(): void {
    pinger ??= setInterval(() => {
      if (streams.size === 0 && pinger !== null) {
        clearInterval(pinger);
        pinger = null;
        return;
      }
      broadcast("ping", "");
    }, FAKE_PING_EVERY_MS);
  }

  function openFakeStream(url: string): SyncStream {
    const listeners = new Map<string, ((message: StreamMessage) => void)[]>();
    let closed = false;
    const stream: FakeStream = {
      addEventListener(type, listener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      close() {
        closed = true;
        streams.delete(stream);
      },
      emit(type, data, id) {
        // Delivered later, as a real stream would be; not on a timer, so faked timers don't hold it.
        queueMicrotask(() => {
          if (!closed) {
            for (const listener of listeners.get(type) ?? []) {
              listener(id === undefined ? { data } : { data, lastEventId: id });
            }
          }
        });
      },
      fail() {
        streams.delete(stream);
        queueMicrotask(() => {
          if (!closed) {
            for (const listener of listeners.get("error") ?? []) {
              listener({ data: "" });
            }
          }
        });
      },
    };
    const code = new URL(url).searchParams.get("code");
    if (offline || code !== pairingCode) {
      stream.fail();
      return stream;
    }
    streams.add(stream);
    startPings();
    if (!silent) {
      stream.emit("log", logMessage());
    }
    return stream;
  }

  async function fakeFetch(
    input: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const route = `${method} ${url.pathname}`;
    counts.set(route, (counts.get(route) ?? 0) + 1);
    const signal = init.signal ?? null;
    if (offline) {
      throw new TypeError("Failed to fetch");
    }
    const headers = new Headers(init.headers);
    const body: unknown =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const response =
      headers.get("X-Pairing-Code") === pairingCode
        ? handle(method, url, body)
        : json(401, { error: "pairing code" });
    const delay = delays.get(route);
    delays.delete(route);
    const dropsLeft = drops.get(route) ?? 0;
    const dropped = dropsLeft > 0;
    drops.set(route, dropsLeft - 1);
    if (!dropped && delay === undefined) {
      return response;
    }
    return new Promise((resolve, reject) => {
      const timer = dropped
        ? null
        : setTimeout(() => {
            resolve(response);
          }, delay);
      signal?.addEventListener("abort", () => {
        if (timer !== null) {
          clearTimeout(timer);
        }
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  }

  return {
    fetch: fakeFetch,
    openStream: openFakeStream,
    get events() {
      return events;
    },
    get logId() {
      return logId;
    },
    requests(route) {
      return counts.get(route) ?? 0;
    },
    dropNextReply(route, times = 1) {
      drops.set(route, times);
    },
    delayNextReply(route, ms) {
      delays.set(route, ms);
    },
    goSilent() {
      silent = true;
    },
    goOffline() {
      offline = true;
      for (const stream of streams) {
        stream.fail();
      }
    },
    comeBack() {
      silent = false;
      offline = false;
    },
    replace(next, device, reason, version = 1) {
      replaceLog(next.filter(isRecord), device, reason, version);
    },
    appendFromOtherIpad(event) {
      append({ ...event, seq: lastSeq() + 1 });
    },
  };
}
