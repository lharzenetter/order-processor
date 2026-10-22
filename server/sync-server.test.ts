import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSyncServer,
  type SyncServer,
  type SyncServerOptions,
} from "./index.ts";

const ORIGIN = "https://lharzenetter.github.io";
const CODE = "K7XM4PQR";
const CERT_EXPIRES_AT = 1_900_000_000_000;
const BASE = "https://kirbe.example.org";

let dataDir: string;
let openServers: SyncServer[] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "kirbe-server-"));
});

afterEach(() => {
  for (const server of openServers) server.close();
  openServers = [];
  vi.useRealTimers();
  rmSync(dataDir, { recursive: true, force: true });
});

function start(overrides: Partial<SyncServerOptions> = {}) {
  const lines: string[] = [];
  const server = createSyncServer({
    pairingCode: CODE,
    allowedOrigin: ORIGIN,
    dataDir,
    certExpiresAt: () => CERT_EXPIRES_AT,
    log: (line) => lines.push(line),
    ...overrides,
  });
  openServers.push(server);
  return { server, lines };
}

interface RequestOptions {
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly code?: string | null;
  readonly origin?: string;
  readonly signal?: AbortSignal;
}

function request(
  method: string,
  path: string,
  options: RequestOptions = {},
): Request {
  const headers = new Headers();
  const code = options.code === undefined ? CODE : options.code;
  if (code !== null) headers.set("X-Pairing-Code", code);
  if (options.origin !== undefined) headers.set("Origin", options.origin);
  let body: string | undefined;
  if (options.rawBody !== undefined) body = options.rawBody;
  else if (options.body !== undefined) body = JSON.stringify(options.body);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

interface LogHead {
  logId: string;
  formatVersion: number | null;
  lastSeq: number;
  ids: string[];
  certExpiresAt: number | null;
}

async function getLog(server: SyncServer): Promise<LogHead> {
  const response = await server.handle(request("GET", "/log"));
  expect(response.status).toBe(200);
  return (await response.json()) as LogHead;
}

function stamped(id: string, seq: number, extra: Record<string, unknown> = {}) {
  return {
    type: "platesBuzzed",
    orderId: "order-1",
    productId: "schaeufele",
    count: 1,
    id,
    seq,
    at: 1_000 + seq,
    ...extra,
  };
}

function post(server: SyncServer, logId: string, event: unknown) {
  return server.handle(
    request("POST", "/log/events", { body: { logId, event } }),
  );
}

function put(
  server: SyncServer,
  ifLogId: string,
  events: readonly unknown[],
  extra: Record<string, unknown> = {},
) {
  return server.handle(
    request("PUT", "/log", {
      body: {
        ifLogId,
        formatVersion: 1,
        events,
        device: "Annahme",
        reason: "push",
        ...extra,
      },
    }),
  );
}

async function pushLog(
  server: SyncServer,
  events: readonly unknown[],
): Promise<string> {
  const { logId } = await getLog(server);
  const response = await put(server, logId, events);
  expect(response.status).toBe(200);
  return ((await response.json()) as { logId: string }).logId;
}

interface StreamMessage {
  event: string;
  id: string | undefined;
  data: string;
}

function parseMessages(text: string): StreamMessage[] {
  return text
    .split("\n\n")
    .filter((block) => block !== "")
    .map((block) => {
      const message: StreamMessage = {
        event: "message",
        id: undefined,
        data: "",
      };
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = line.slice(0, colon);
        const value = line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") message.event = value;
        if (field === "id") message.id = value;
        if (field === "data") message.data = value;
      }
      return message;
    });
}

function readStream(response: Response) {
  if (response.body === null) throw new Error("The stream reply has no body.");
  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  return {
    get text() {
      return text;
    },
    messages() {
      return parseMessages(text);
    },
    async until(
      predicate: (text: string) => boolean,
    ): Promise<StreamMessage[]> {
      while (!predicate(text)) {
        const { done, value } = await reader.read();
        if (done) throw new Error(`The stream ended early after: ${text}`);
        text += decoder.decode(value, { stream: true });
      }
      return parseMessages(text);
    },
    async untilMessages(count: number): Promise<StreamMessage[]> {
      return this.until((current) => parseMessages(current).length >= count);
    },
    async ended(): Promise<boolean> {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return true;
        text += decoder.decode(value, { stream: true });
      }
    },
    read: () => reader.read(),
    cancel: () => reader.cancel(),
  };
}

async function openStream(
  server: SyncServer,
  query = `?code=${CODE}`,
  signal?: AbortSignal,
) {
  const response = await server.handle(
    request("GET", `/log/stream${query}`, {
      code: null,
      ...(signal === undefined ? {} : { signal }),
    }),
  );
  expect(response.status).toBe(200);
  return readStream(response);
}

describe("GET /log", () => {
  it("describes a fresh server: a minted logId, no format yet and an empty log", async () => {
    const { server } = start();

    const response = await server.handle(request("GET", "/log"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const head = (await response.json()) as LogHead;
    expect(head).toEqual({
      logId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      formatVersion: null,
      lastSeq: 0,
      ids: [],
      certExpiresAt: CERT_EXPIRES_AT,
    });
  });

  it("reads the certificate's expiry on every request", async () => {
    let certExpiresAt: number | null = null;
    const { server } = start({ certExpiresAt: () => certExpiresAt });

    expect((await getLog(server)).certExpiresAt).toBeNull();
    certExpiresAt = 2_000_000_000_000;
    expect((await getLog(server)).certExpiresAt).toBe(2_000_000_000_000);
  });

  it("lists every event id in seq order", async () => {
    // server-sync 02
    const { server } = start();
    const { logId } = await getLog(server);
    await post(server, logId, stamped("b", 1));
    await post(server, logId, stamped("a", 2));

    expect(await getLog(server)).toMatchObject({ lastSeq: 2, ids: ["b", "a"] });
  });
});

describe("POST /log/events", () => {
  it("appends an event at lastSeq + 1 and replies with its seq", async () => {
    // server-sync 02
    const { server } = start();
    const { logId } = await getLog(server);

    const response = await post(server, logId, stamped("e1", 1));

    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ seq: 1 });
    expect(await getLog(server)).toMatchObject({
      logId,
      lastSeq: 1,
      ids: ["e1"],
    });
  });

  it("refuses a stale seq with the current logId and lastSeq", async () => {
    // server-sync 02
    const { server } = start();
    const { logId } = await getLog(server);
    await post(server, logId, stamped("e1", 1));

    const response = await post(server, logId, stamped("e2", 1));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ logId, lastSeq: 1 });
  });

  it("refuses a seq that skips ahead", async () => {
    // server-sync 02
    const { server } = start();
    const { logId } = await getLog(server);

    const response = await post(server, logId, stamped("e3", 3));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ logId, lastSeq: 0 });
    expect((await getLog(server)).ids).toEqual([]);
  });

  it("refuses an event for another log, even one whose id it knows", async () => {
    // server-sync 02
    const { server } = start();
    const { logId } = await getLog(server);
    await post(server, logId, stamped("e1", 1));

    const response = await post(server, "an-old-log", stamped("e1", 1));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ logId, lastSeq: 1 });
  });

  it("answers a retry of an event it already has with that event's seq", async () => {
    // server-sync 02: a retry of a tap that landed is harmless
    const { server } = start();
    const { logId } = await getLog(server);
    await post(server, logId, stamped("e1", 1));
    await post(server, logId, stamped("e2", 2));

    const response = await post(server, logId, stamped("e1", 3));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ seq: 1 });
    expect((await getLog(server)).ids).toEqual(["e1", "e2"]);
  });

  it.each([
    ["no event", { logId: "x" }],
    ["an event without an id", { logId: "x", event: { seq: 1 } }],
    ["an event with a numeric id", { logId: "x", event: { id: 7, seq: 1 } }],
    [
      "an event with a fractional seq",
      { logId: "x", event: { id: "e1", seq: 1.5 } },
    ],
    ["an event that is an array", { logId: "x", event: [] }],
    ["no logId", { event: { id: "e1", seq: 1 } }],
    ["a body that is not an object", ["e1"]],
  ])("refuses a body with %s", async (_, body) => {
    const { server } = start();

    const response = await server.handle(
      request("POST", "/log/events", { body }),
    );

    expect(response.status).toBe(400);
  });

  it("refuses a body that is not JSON", async () => {
    const { server } = start();

    const response = await server.handle(
      request("POST", "/log/events", { rawBody: "{not json" }),
    );

    expect(response.status).toBe(400);
  });
});

describe("GET /log/events", () => {
  it("returns the events after a seq, in order, exactly as they were sent", async () => {
    // server-sync 02
    const { server } = start();
    const { logId } = await getLog(server);
    const events = [
      stamped("e1", 1),
      stamped("e2", 2, { device: "Ausgabe" }),
      stamped("e3", 3, { futureField: { nested: [1, 2] } }),
    ];
    for (const event of events) await post(server, logId, event);

    const response = await server.handle(request("GET", "/log/events?after=1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual([events[1], events[2]]);
  });

  it("refuses an after that is not a whole number", async () => {
    const { server } = start();

    const response = await server.handle(
      request("GET", "/log/events?after=-1"),
    );

    expect(response.status).toBe(400);
  });
});

describe("PUT /log", () => {
  it("replaces the log, takes formatVersion from the push and mints a new logId", async () => {
    // server-sync 02
    const { server } = start();
    const { logId: firstLogId } = await getLog(server);

    const response = await put(
      server,
      firstLogId,
      [stamped("e1", 1), stamped("e2", 2)],
      {
        formatVersion: 3,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const { logId } = (await response.json()) as { logId: string };
    expect(logId).not.toBe(firstLogId);
    expect(await getLog(server)).toEqual({
      logId,
      formatVersion: 3,
      lastSeq: 2,
      ids: ["e1", "e2"],
      certExpiresAt: CERT_EXPIRES_AT,
    });
  });

  it("empties the log for a new Fest", async () => {
    const { server } = start();
    await pushLog(server, [stamped("e1", 1)]);

    const logId = await pushLog(server, []);

    expect(await getLog(server)).toMatchObject({ logId, lastSeq: 0, ids: [] });
  });

  it("refuses a replacement of a log that was already replaced", async () => {
    // server-sync 02
    const { server } = start();
    const { logId: oldLogId } = await getLog(server);
    const logId = await pushLog(server, [stamped("e1", 1)]);

    const response = await put(server, oldLogId, []);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ logId, lastSeq: 1 });
  });

  it.each([
    ["a seq gap", [stamped("e1", 1), stamped("e3", 3)], {}],
    ["a log not starting at seq 1", [stamped("e2", 2)], {}],
    ["duplicate ids", [stamped("e1", 1), stamped("e1", 2)], {}],
    ["an event that is not an object", [stamped("e1", 1), "e2"], {}],
    ["an event that is null", [null], {}],
    ["an event without a string id", [{ seq: 1 }], {}],
    ["an unknown reason", [], { reason: "merge" }],
    ["a device that is not a string", [], { device: 2 }],
    ["no formatVersion", [], { formatVersion: undefined }],
    ["events that are not an array", { e1: 1 }, {}],
  ])("refuses a log with %s and changes nothing", async (_, events, extra) => {
    // server-sync 02: the server checks shape only
    const { server } = start();
    const before = await getLog(server);

    const response = await put(
      server,
      before.logId,
      events as unknown[],
      extra,
    );

    expect(response.status).toBe(400);
    expect(await getLog(server)).toEqual(before);
  });

  it("archives a non-empty old log as an export file named by time and logId", async () => {
    // server-sync 02
    vi.useFakeTimers({
      now: Date.UTC(2026, 9, 24, 18, 30, 5, 123),
      toFake: ["Date"],
    });
    const { server } = start();
    const events = [stamped("e1", 1), stamped("e2", 2, { device: "Annahme" })];
    const oldLogId = await pushLog(server, events);

    await put(server, oldLogId, [], { reason: "newFest" });

    const archive = join(dataDir, "archive");
    expect(readdirSync(archive)).toEqual([
      `2026-10-24T18-30-05.123Z-${oldLogId}.json`,
    ]);
    const file: unknown = JSON.parse(
      readFileSync(
        join(archive, `2026-10-24T18-30-05.123Z-${oldLogId}.json`),
        "utf8",
      ),
    );
    expect(file).toEqual({
      app: "kirbe-pager",
      formatVersion: 1,
      exportedAt: Date.UTC(2026, 9, 24, 18, 30, 5, 123),
      events,
    });
  });

  it("writes no archive for an empty old log", async () => {
    const { server } = start();
    const logId = await pushLog(server, []);

    await put(server, logId, [stamped("e1", 1)]);

    const archive = join(dataDir, "archive");
    expect(existsSync(archive) ? readdirSync(archive) : []).toEqual([]);
  });
});

describe("persistence", () => {
  it("keeps lastSeq, ids, logId and formatVersion across a close and reopen", async () => {
    const first = start().server;
    const logId = await pushLog(first, [stamped("e1", 1)]);
    await post(first, logId, stamped("e2", 2));
    const before = await getLog(first);
    first.close();

    const reopened = start().server;

    expect(await getLog(reopened)).toEqual(before);
    expect(before).toMatchObject({
      logId,
      lastSeq: 2,
      ids: ["e1", "e2"],
      formatVersion: 1,
    });
  });
});

describe("GET /log/stream", () => {
  it("sends the log message first, with no previous log for the one minted at first start", async () => {
    // server-sync 02
    const { server } = start();
    const { logId } = await getLog(server);
    await post(server, logId, stamped("e1", 1));

    const response = await server.handle(
      request("GET", `/log/stream?code=${CODE}`, { code: null }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const [first] = await readStream(response).untilMessages(1);
    expect(first?.event).toBe("log");
    expect(JSON.parse(first?.data ?? "")).toEqual({
      logId,
      previousLogId: null,
      lastSeq: 1,
      device: null,
      reason: null,
    });
  });

  it("pushes every appended event to every open stream, with its seq as the id", async () => {
    // server-sync 02
    const { server } = start();
    const { logId } = await getLog(server);
    const one = await openStream(server);
    const two = await openStream(server);
    await one.untilMessages(1);
    await two.untilMessages(1);
    const event = stamped("e1", 1, { device: "Ausgabe" });

    await post(server, logId, event);

    for (const stream of [one, two]) {
      const messages = await stream.untilMessages(2);
      expect(messages[1]).toEqual({
        event: "appended",
        id: "1",
        data: JSON.stringify(event),
      });
    }
  });

  it("does not push a refused or repeated append", async () => {
    const { server } = start();
    const { logId } = await getLog(server);
    const stream = await openStream(server);
    await post(server, logId, stamped("e1", 1));
    await post(server, logId, stamped("e1", 1));
    await post(server, logId, stamped("e9", 9));
    await post(server, logId, stamped("e2", 2));

    const messages = await stream.untilMessages(3);

    expect(messages.map((message) => message.id)).toEqual([
      undefined,
      "1",
      "2",
    ]);
  });

  it("sends the log message to every open stream after a replacement", async () => {
    // server-sync 02
    const { server } = start();
    const { logId: firstLogId } = await getLog(server);
    const stream = await openStream(server);
    await stream.untilMessages(1);

    const response = await put(server, firstLogId, [stamped("e1", 1)], {
      device: "Annahme",
      reason: "import",
    });
    const { logId } = (await response.json()) as { logId: string };

    const messages = await stream.untilMessages(2);
    expect(messages[1]?.event).toBe("log");
    expect(JSON.parse(messages[1]?.data ?? "")).toEqual({
      logId,
      previousLogId: firstLogId,
      lastSeq: 1,
      device: "Annahme",
      reason: "import",
    });
  });

  it("names the replacement that started the log to a stream opened later", async () => {
    const { server } = start();
    const { logId: firstLogId } = await getLog(server);
    const logId = await pushLog(server, []);

    const [first] = await (await openStream(server)).untilMessages(1);

    expect(JSON.parse(first?.data ?? "")).toEqual({
      logId,
      previousLogId: firstLogId,
      lastSeq: 0,
      device: "Annahme",
      reason: "push",
    });
  });

  it("sends a ping every 10 s that an EventSource can observe", async () => {
    // server-sync 02
    vi.useFakeTimers();
    const { server } = start();
    const stream = await openStream(server);
    await stream.untilMessages(1);

    await vi.advanceTimersByTimeAsync(9_999);
    const next = stream.read();
    const early = await Promise.race([
      next.then(() => "chunk"),
      vi.advanceTimersByTimeAsync(0).then(() => "nothing"),
    ]);
    expect(early).toBe("nothing");

    await vi.advanceTimersByTimeAsync(1);
    const { value } = await next;
    expect(new TextDecoder().decode(value)).toBe(
      ": ping\nevent: ping\ndata: \n\n",
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const second = await stream.read();
    expect(new TextDecoder().decode(second.value)).toBe(
      ": ping\nevent: ping\ndata: \n\n",
    );
  });

  it("stops pushing to a stream whose reader cancelled", async () => {
    const { server } = start();
    const { logId } = await getLog(server);
    const stream = await openStream(server);
    await stream.untilMessages(1);

    await stream.cancel();

    expect((await post(server, logId, stamped("e1", 1))).status).toBe(201);
  });

  it("ends a stream whose request was aborted", async () => {
    const { server } = start();
    const { logId } = await getLog(server);
    const abort = new AbortController();
    const stream = await openStream(server, `?code=${CODE}`, abort.signal);
    await stream.untilMessages(1);

    abort.abort();

    expect(await stream.ended()).toBe(true);
    expect((await post(server, logId, stamped("e1", 1))).status).toBe(201);
  });

  it("ends every open stream on close", async () => {
    const { server } = start();
    const stream = await openStream(server);

    server.close();

    expect(await stream.ended()).toBe(true);
  });
});

describe("pairing code", () => {
  it.each([
    ["GET", "/log", undefined],
    ["GET", "/log/events?after=0", undefined],
    ["POST", "/log/events", { logId: "x", event: { id: "e1", seq: 1 } }],
    [
      "PUT",
      "/log",
      {
        ifLogId: "x",
        formatVersion: 1,
        events: [],
        device: "A",
        reason: "push",
      },
    ],
  ])(
    "refuses %s %s without a code or with a wrong one",
    async (method, path, body) => {
      // server-sync 02
      const { server } = start();

      for (const code of [null, "", "WRONGCDE", "K7XM4PQ", `${CODE}X`]) {
        const response = await server.handle(
          request(method, path, { body, code }),
        );
        expect(response.status).toBe(401);
      }
    },
  );

  it("checks the code before the body", async () => {
    const { server } = start();

    const response = await server.handle(
      request("POST", "/log/events", {
        rawBody: "{not json",
        code: "WRONGCDE",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("refuses the stream without code= or with a wrong one", async () => {
    // server-sync 02
    const { server } = start();

    for (const query of [
      "",
      "?code=",
      "?code=WRONGCDE",
      `?code=${CODE.toLowerCase()}`,
    ]) {
      const response = await server.handle(
        request("GET", `/log/stream${query}`, { code: null }),
      );
      expect(response.status).toBe(401);
    }
  });

  it("takes code= only on the stream", async () => {
    const { server } = start();

    const response = await server.handle(
      request("GET", `/log?code=${CODE}`, { code: null }),
    );

    expect(response.status).toBe(401);
  });

  it("never writes the code or a query string to the log output", async () => {
    // server-sync 02
    const { server, lines } = start();
    const { logId } = await getLog(server);
    await post(server, logId, stamped("e1", 1));
    await server.handle(request("GET", "/log/events?after=0"));
    await server.handle(request("GET", "/log", { code: "WRONGCDE" }));
    await openStream(server);
    await server.handle(
      request("GET", "/log/stream?code=WRONGCDE", { code: null }),
    );

    const output = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(output).not.toContain(CODE);
    expect(output).not.toContain("WRONGCDE");
    expect(output).not.toContain("?");
    expect(output).not.toContain("after=");
    expect(lines).toContain("GET /log/stream 200");
    expect(lines).toContain("GET /log 401");
  });
});

describe("CORS", () => {
  it("allows the configured origin on every reply, a refused one included", async () => {
    // server-sync 02
    const { server } = start();

    for (const code of [CODE, "WRONGCDE"]) {
      const response = await server.handle(
        request("GET", "/log", { origin: ORIGIN, code }),
      );
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(response.headers.get("Vary")).toBe("Origin");
    }
  });

  it("allows no other origin", async () => {
    // server-sync 02
    const { server } = start();

    const response = await server.handle(
      request("GET", "/log", { origin: "https://evil.example.org" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers the preflight for the configured origin without a code", async () => {
    // server-sync 02
    const { server } = start();

    const response = await server.handle(
      request("OPTIONS", "/log/events", { origin: ORIGIN, code: null }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, POST, PUT",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type, X-Pairing-Code",
    );
    expect(response.headers.get("Access-Control-Max-Age")).toMatch(/^\d+$/);
  });

  it("refuses the preflight for any other origin", async () => {
    const { server } = start();

    const response = await server.handle(
      request("OPTIONS", "/log/events", {
        origin: "https://evil.example.org",
        code: null,
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("routes", () => {
  it.each([
    ["GET", "/"],
    ["GET", "/logs"],
    ["DELETE", "/log"],
    ["POST", "/log"],
    ["PUT", "/log/events"],
  ])("answers %s %s with 404", async (method, path) => {
    const { server } = start();

    const response = await server.handle(request(method, path));

    expect(response.status).toBe(404);
  });
});
