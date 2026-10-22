import type { Event } from "../core/index";
import { FORMAT_VERSION, readableEvents } from "./device-store";
import type {
  AppendResult,
  DecideQuestion,
  DeviceStore,
  EventLog,
  LogChange,
  ReplaceReason,
  SyncSettings,
} from "./device-store";
import { isEvent, isRecord } from "./guards";

// server-sync 02: the timings of the sync protocol.
export const REQUEST_TIMEOUT_MS = 4_000;
export const WATCHDOG_MS = 25_000;
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000] as const;

/** What a stream listener receives; a browser `MessageEvent` is one. */
export interface StreamMessage {
  readonly data: unknown;
  /** The SSE `id:`; an `appended` message carries its `seq`. */
  readonly lastEventId?: string;
}

/** The live channel, shaped so that a browser `EventSource` is one. */
export interface SyncStream {
  addEventListener(
    type: string,
    listener: (message: StreamMessage) => void,
  ): void;
  close(): void;
}

export type OpenStream = (url: string) => SyncStream;
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServerLogOptions {
  readonly mirror: DeviceStore;
  readonly settings: SyncSettings;
  readonly fetch: Fetch;
  readonly openStream: OpenStream;
}

export type ReplaceResult =
  | { readonly kind: "replaced" }
  /** The server's log was replaced by another iPad first; nothing changed here. */
  | { readonly kind: "conflict" };

/** The event log in sync mode: the server's, mirrored in the `DeviceStore`. */
export interface ServerLog extends EventLog {
  /** Starts connecting; subscribe first. */
  start(): void;
  /** Trennen: stops for good and drops a pending tap, which was never shown. */
  close(): void;
  /** Replaces the server's log; every iPad follows. Throws `ImportRejectedError` before sending. */
  replace(
    events: readonly unknown[],
    reason: Exclude<ReplaceReason, "push">,
  ): Promise<ReplaceResult>;
  /** Answers a `decide`: Hochladen und verbinden. */
  pushLocal(): Promise<ReplaceResult>;
  /** Answers a `decide`: Durch Server-Protokoll ersetzen. */
  adoptServer(): Promise<void>;
  /** The certificate's expiry the server last reported, in ms. */
  certExpiresAt(): number | null;
}

/** The result of the Verbinden test. */
export type ServerTest =
  | {
      readonly kind: "ok";
      readonly eventCount: number;
      readonly certExpiresAt: number | null;
    }
  | { readonly kind: "unreachable" }
  | { readonly kind: "pairingCode" }
  | { readonly kind: "version" };

interface LogInfo {
  readonly logId: string;
  readonly formatVersion: unknown;
  readonly lastSeq: number;
  readonly ids: readonly string[];
  readonly certExpiresAt: number | null;
}

interface LogMessage {
  readonly logId: string;
  readonly previousLogId: string | null;
  readonly device: string | null;
  readonly reason: string | null;
}

interface Pending {
  readonly event: Event;
  /** The log the tap was made on; a tap never crosses into another log. */
  readonly logId: string;
  readonly resolve: (result: AppendResult) => void;
}

type Phase =
  | "idle"
  | "connecting"
  | "deciding"
  | "connected"
  | "disconnected"
  | "rejected"
  | "closed";

/** Thrown inside a connect attempt that a newer attempt or Trennen has overtaken. */
class Overtaken extends Error {}

function serverUrl(settings: SyncSettings, path: string): string {
  return `https://${settings.serverAddress}${path}`;
}

async function request(
  fetch: Fetch,
  settings: SyncSettings,
  path: string,
  init: { readonly method?: string; readonly body?: unknown } = {},
): Promise<{ readonly status: number; readonly body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(serverUrl(settings, path), {
      method: init.method ?? "GET",
      headers: {
        "X-Pairing-Code": settings.pairingCode,
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function toLogInfo(body: unknown): LogInfo | null {
  if (
    !isRecord(body) ||
    typeof body.logId !== "string" ||
    typeof body.lastSeq !== "number" ||
    !Array.isArray(body.ids)
  ) {
    return null;
  }
  const ids: unknown[] = body.ids;
  return {
    logId: body.logId,
    formatVersion: body.formatVersion,
    lastSeq: body.lastSeq,
    ids: ids.filter((id) => typeof id === "string"),
    certExpiresAt:
      typeof body.certExpiresAt === "number" ? body.certExpiresAt : null,
  };
}

// An empty, never-pushed server reports `null` and fits every build.
function fitsThisBuild(info: LogInfo): boolean {
  return info.formatVersion === null || info.formatVersion === FORMAT_VERSION;
}

function toLogMessage(data: unknown): LogMessage | null {
  const body: unknown = typeof data === "string" ? parseJson(data) : null;
  if (!isRecord(body) || typeof body.logId !== "string") {
    return null;
  }
  return {
    logId: body.logId,
    previousLogId:
      typeof body.previousLogId === "string" ? body.previousLogId : null,
    device: typeof body.device === "string" ? body.device : null,
    reason: typeof body.reason === "string" ? body.reason : null,
  };
}

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

function followedBy(
  message: LogMessage,
): Extract<LogChange, { kind: "replaced" }>["by"] {
  const { device, reason } = message;
  if (
    device !== null &&
    (reason === "newFest" || reason === "import" || reason === "overwrite")
  ) {
    return { device, reason };
  }
  return undefined;
}

function isPrefix(shorter: readonly string[], longer: readonly string[]) {
  return shorter.every((id, index) => longer[index] === id);
}

/** The Verbinden test: reaches the server with the code and checks the format. Saves nothing. */
export async function testServer(
  settings: SyncSettings,
  fetch: Fetch,
): Promise<ServerTest> {
  try {
    const { status, body } = await request(fetch, settings, "/log");
    if (status === 401) {
      return { kind: "pairingCode" };
    }
    const info = status === 200 ? toLogInfo(body) : null;
    if (info === null) {
      return { kind: "unreachable" };
    }
    return fitsThisBuild(info)
      ? {
          kind: "ok",
          eventCount: info.lastSeq,
          certExpiresAt: info.certExpiresAt,
        }
      : { kind: "version" };
  } catch {
    return { kind: "unreachable" };
  }
}

export function createServerLog(options: ServerLogOptions): ServerLog {
  const { mirror, settings, openStream } = options;
  const listeners = new Set<(change: LogChange) => void>();
  let phase: Phase = "idle";
  // Bumped by every attempt and by Trennen, so a stale attempt's callbacks do nothing.
  let attempt = 0;
  let backoffIndex = 0;
  let stream: SyncStream | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let serverLogId: string | null = null;
  let certExpiresAt: number | null = null;
  let mirrorLastSeq = 0;
  let pending: Pending | null = null;
  // Live events that arrive before the catch-up is done; replayed once it is.
  let buffered: Event[] = [];
  // Mirror writes, comparisons and replacements run one after another.
  let queue: Promise<unknown> = Promise.resolve();

  function emit(change: LogChange): void {
    for (const listener of listeners) {
      listener(change);
    }
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  }

  function call(path: string, init?: { method?: string; body?: unknown }) {
    return request(options.fetch, settings, path, init);
  }

  function stopTimers(): void {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
  }

  function closeStream(): void {
    stream?.close();
    stream = null;
  }

  function resetWatchdog(current: number): void {
    if (watchdog !== null) {
      clearTimeout(watchdog);
    }
    watchdog = setTimeout(() => {
      fail(current);
    }, WATCHDOG_MS);
  }

  function settle(result: AppendResult): void {
    const settled = pending;
    pending = null;
    settled?.resolve(result);
  }

  /** The attempt failed or went silent: blocked, retried with backoff; a pending tap waits. */
  function fail(current: number): void {
    if (current !== attempt || phase === "closed" || phase === "rejected") {
      return;
    }
    stopTimers();
    closeStream();
    phase = "disconnected";
    emit({ kind: "connection", connection: "disconnected" });
    const delay =
      BACKOFF_MS[Math.min(backoffIndex, BACKOFF_MS.length - 1)] ?? 10_000;
    backoffIndex += 1;
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, delay);
  }

  function reject(reason: "pairingCode" | "version"): void {
    attempt += 1;
    stopTimers();
    closeStream();
    phase = "rejected";
    settle({ kind: "dropped" });
    emit({ kind: "rejected", reason });
  }

  function connect(): void {
    if (phase === "closed" || phase === "rejected") {
      return;
    }
    attempt += 1;
    const current = attempt;
    stopTimers();
    closeStream();
    buffered = [];
    if (phase !== "deciding") {
      phase = "connecting";
    }
    emit({ kind: "connection", connection: "connecting" });
    void handshake(current);
  }

  async function handshake(current: number): Promise<void> {
    let info: LogInfo | null;
    try {
      const { status, body } = await call("/log");
      if (current !== attempt) {
        return;
      }
      if (status === 401) {
        reject("pairingCode");
        return;
      }
      info = status === 200 ? toLogInfo(body) : null;
    } catch {
      fail(current);
      return;
    }
    if (info === null) {
      fail(current);
      return;
    }
    certExpiresAt = info.certExpiresAt;
    if (!fitsThisBuild(info)) {
      reject("version");
      return;
    }
    const opened = openStream(
      serverUrl(
        settings,
        `/log/stream?code=${encodeURIComponent(settings.pairingCode)}`,
      ),
    );
    stream = opened;
    let heardLog = false;
    resetWatchdog(current);
    opened.addEventListener("log", (message) => {
      if (current !== attempt) {
        return;
      }
      heardLog = true;
      resetWatchdog(current);
      const parsed = toLogMessage(message.data);
      if (parsed !== null) {
        enqueue(() => reconcile(parsed, current)).catch((error: unknown) => {
          if (!(error instanceof Overtaken)) {
            fail(current);
          }
        });
      }
    });
    opened.addEventListener("appended", (message) => {
      if (current !== attempt || !heardLog) {
        return;
      }
      resetWatchdog(current);
      const data =
        typeof message.data === "string" ? parseJson(message.data) : null;
      if (!isEvent(data)) {
        return;
      }
      if (phase !== "connected") {
        buffered.push(data);
        return;
      }
      enqueue(() => mirrorLive([data])).catch(() => {
        fail(current);
      });
    });
    opened.addEventListener("ping", () => {
      // Until the first `log` message, pings don't count: a stream that missed it is dead.
      if (current === attempt && heardLog) {
        resetWatchdog(current);
      }
    });
    opened.addEventListener("error", () => {
      fail(current);
    });
  }

  function check(current: number): void {
    if (current !== attempt) {
      throw new Overtaken();
    }
  }

  async function fetchLog(current: number): Promise<LogInfo> {
    const { status, body } = await call("/log");
    check(current);
    const info = status === 200 ? toLogInfo(body) : null;
    if (info === null) {
      throw new Error(`GET /log answered ${String(status)}`);
    }
    certExpiresAt = info.certExpiresAt;
    return info;
  }

  async function fetchEvents(after: number, current: number) {
    const { status, body } = await call(`/log/events?after=${String(after)}`);
    check(current);
    if (status !== 200 || !Array.isArray(body)) {
      throw new Error(`GET /log/events answered ${String(status)}`);
    }
    const events: unknown[] = body;
    const valid = events.filter(isEvent);
    if (valid.length !== events.length) {
      throw new Error("The server sent an event this build can't read");
    }
    return valid;
  }

  /** Writes live events to the mirror, then hands them out; catches up over a gap. */
  async function mirrorLive(events: readonly Event[]): Promise<void> {
    const logId = serverLogId;
    if (logId === null) {
      return;
    }
    const fresh = events.filter((event) => event.seq > mirrorLastSeq);
    const first = fresh[0];
    if (first === undefined) {
      return;
    }
    if (first.seq !== mirrorLastSeq + 1) {
      await catchUp(attempt);
      return;
    }
    const contiguous = fresh.filter(
      (event, index) => event.seq === first.seq + index,
    );
    const last = contiguous.at(-1)?.seq ?? mirrorLastSeq;
    await mirror.recordFromServer(contiguous, logId, last);
    mirrorLastSeq = last;
    emit({ kind: "appended", events: contiguous });
    if (contiguous.length < fresh.length) {
      await catchUp(attempt);
    }
  }

  async function catchUp(current: number): Promise<void> {
    const logId = serverLogId;
    if (logId === null) {
      return;
    }
    const events = await fetchEvents(mirrorLastSeq, current);
    const last = events.at(-1)?.seq ?? mirrorLastSeq;
    await mirror.recordFromServer(events, logId, Math.max(last, mirrorLastSeq));
    mirrorLastSeq = last;
    if (events.length > 0) {
      emit({ kind: "appended", events });
    }
  }

  async function replaceMirror(events: readonly Event[], logId: string) {
    await mirror.replaceLog(events, logId);
    mirrorLastSeq = events.at(-1)?.seq ?? 0;
  }

  function decide(question: DecideQuestion): void {
    phase = "deciding";
    settle({ kind: "dropped" });
    emit({ kind: "decide", question });
  }

  /** The follow rule, then the comparison, then the catch-up (server-sync 02). */
  async function reconcile(message: LogMessage, current: number) {
    check(current);
    serverLogId = message.logId;
    const meta = await mirror.meta();
    if (phase === "connected" && meta.logId === message.logId) {
      // This iPad's own replacement, already applied.
      return;
    }
    if (phase === "connected") {
      // Another iPad replaced the log: taps stay disabled until the follow is done.
      phase = "connecting";
      emit({ kind: "connection", connection: "connecting" });
    }
    const info = await fetchLog(current);
    if (info.logId !== message.logId) {
      // Replaced again meanwhile; the newer `log` message follows.
      return;
    }
    if (!fitsThisBuild(info)) {
      reject("version");
      return;
    }
    const local = await mirror.load();
    check(current);
    mirrorLastSeq = local.at(-1)?.seq ?? 0;
    const localIds = local.map((event) => event.id);
    function diverged(): void {
      decide({
        kind: "diverged",
        localCount: local.length,
        serverCount: info.lastSeq,
      });
    }

    if (meta.logId !== undefined && meta.logId !== message.logId) {
      if (meta.logId === message.previousLogId) {
        if (mirrorLastSeq <= (meta.serverSeq ?? 0)) {
          await replaceMirror(await fetchEvents(0, current), info.logId);
          settle({ kind: "dropped" });
          const by = followedBy(message);
          emit(
            by === undefined ? { kind: "replaced" } : { kind: "replaced", by },
          );
          await finish(current);
        } else {
          diverged();
        }
        return;
      }
    }

    // Empty is a prefix too; staff are asked only when the mirror holds another log's events.
    if (
      info.ids.length === 0 &&
      local.length > 0 &&
      meta.logId !== info.logId
    ) {
      decide({ kind: "serverEmpty", localCount: local.length });
      return;
    }
    if (isPrefix(localIds, info.ids)) {
      // Identical, or this iPad is behind (a fresh one included).
      if (pending !== null && pending.logId !== info.logId) {
        settle({ kind: "dropped" });
      }
      await mirror.recordFromServer([], info.logId, mirrorLastSeq);
      await catchUp(current);
      await finish(current);
      return;
    }
    if (isPrefix(info.ids, localIds)) {
      // The recovery after a standalone fallback: the server gets what it missed.
      await mirror.recordFromServer([], info.logId, info.lastSeq);
      for (const event of local.slice(info.ids.length)) {
        const { status } = await call("/log/events", {
          method: "POST",
          body: { logId: info.logId, event },
        });
        check(current);
        if (status === 409) {
          diverged();
          return;
        }
        if (status !== 201) {
          throw new Error(`POST /log/events answered ${String(status)}`);
        }
        await mirror.recordFromServer([], info.logId, event.seq);
      }
      await finish(current);
      return;
    }
    diverged();
  }

  async function finish(current: number): Promise<void> {
    check(current);
    const live = buffered;
    buffered = [];
    phase = "connected";
    backoffIndex = 0;
    await mirrorLive(live);
    emit({ kind: "connection", connection: "connected" });
    const waiting = pending;
    if (waiting === null) {
      return;
    }
    const known = (await mirror.load()).some(
      (event) => event.id === waiting.event.id,
    );
    if (known) {
      settle({ kind: "appended" });
    } else if (waiting.logId === serverLogId) {
      // One normal attempt; a stale seq comes back as `stale` for the re-check.
      void send(waiting);
    } else {
      settle({ kind: "dropped" });
    }
  }

  async function send(tap: Pending): Promise<void> {
    const current = attempt;
    for (let round = 0; round < 2; round += 1) {
      let reply: { readonly status: number; readonly body: unknown };
      try {
        reply = await call("/log/events", {
          method: "POST",
          body: { logId: tap.logId, event: tap.event },
        });
      } catch {
        continue;
      }
      if (pending !== tap) {
        return;
      }
      if (await answer(tap, reply)) {
        return;
      }
    }
    // No reply after the retry: blocked until the reconnect settles the tap.
    fail(current);
  }

  /** Settles the tap by the server's reply; `false` for a reply that counts as none. */
  async function answer(
    tap: Pending,
    reply: { readonly status: number; readonly body: unknown },
  ): Promise<boolean> {
    const { status, body } = reply;
    if (status === 201) {
      await enqueue(async () => {
        if (tap.event.seq > mirrorLastSeq) {
          await mirror.recordFromServer([tap.event], tap.logId, tap.event.seq);
          mirrorLastSeq = tap.event.seq;
        }
      });
      settle({ kind: "appended" });
      return true;
    }
    if (status === 409 && isRecord(body) && body.logId === tap.logId) {
      const missed = await enqueue(async () => {
        await catchUp(attempt);
        return (await mirror.load()).filter(
          (event) => event.seq >= tap.event.seq,
        );
      });
      settle({ kind: "stale", missed });
      return true;
    }
    if (status === 401) {
      reject("pairingCode");
      return true;
    }
    if (status === 409) {
      // A new log: the change arrives as a replacement.
      settle({ kind: "dropped" });
      return true;
    }
    // A server error is retried like a lost reply; a pending tap is lost only with the app.
    return false;
  }

  function handleVisibility(): void {
    if (
      document.visibilityState === "visible" &&
      (phase === "connected" || phase === "disconnected")
    ) {
      connect();
    }
  }

  async function putLog(
    events: readonly Event[],
    reason: ReplaceReason,
  ): Promise<ReplaceResult> {
    return enqueue(async () => {
      const { status, body } = await call("/log", {
        method: "PUT",
        body: {
          ifLogId: serverLogId,
          formatVersion: FORMAT_VERSION,
          events,
          device: settings.deviceName,
          reason,
        },
      });
      if (status === 409) {
        return { kind: "conflict" } as const;
      }
      if (status !== 200 || !isRecord(body) || typeof body.logId !== "string") {
        throw new Error(`PUT /log answered ${String(status)}`);
      }
      serverLogId = body.logId;
      await replaceMirror(events, body.logId);
      settle({ kind: "dropped" });
      emit({ kind: "replaced" });
      if (phase === "deciding") {
        await finish(attempt);
      }
      return { kind: "replaced" } as const;
    });
  }

  return {
    load() {
      return mirror.load();
    },
    append(event) {
      if (phase !== "connected" || serverLogId === null || pending !== null) {
        return Promise.resolve({ kind: "dropped" });
      }
      const logId = serverLogId;
      return new Promise((resolve) => {
        const tap: Pending = { event, logId, resolve };
        pending = tap;
        void send(tap);
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (phase !== "idle") {
        return;
      }
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", handleVisibility);
      }
      connect();
    },
    close() {
      attempt += 1;
      phase = "closed";
      stopTimers();
      closeStream();
      settle({ kind: "dropped" });
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    },
    async replace(events, reason) {
      return putLog(readableEvents(events), reason);
    },
    async pushLocal() {
      return putLog(await mirror.load(), "push");
    },
    adoptServer() {
      return enqueue(async () => {
        const current = attempt;
        const info = await fetchLog(current);
        serverLogId = info.logId;
        await replaceMirror(await fetchEvents(0, current), info.logId);
        emit({ kind: "replaced" });
        await finish(current);
      });
    },
    certExpiresAt() {
      return certExpiresAt;
    },
  };
}
