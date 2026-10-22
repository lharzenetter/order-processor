import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../core/index";
import { createFakeSyncServer } from "./fake-sync-server";
import type { FakeSyncServer } from "./fake-sync-server";
import { FORMAT_VERSION, ImportRejectedError, openDeviceStore } from "./index";
import type { DeviceStore, LogChange } from "./index";
import { createServerLog, testServer } from "./server-log";
import type { ServerLog } from "./server-log";

const SETTINGS = {
  serverAddress: "kirbe.example.de",
  pairingCode: "ABCD2345",
  deviceName: "iPad 2",
};

let dbCount = 0;

function event(seq: number, id = `id-${String(seq)}`): Event {
  return { id, seq, at: 1_000 * seq, type: "pagerMarkedMissing", pager: seq };
}

async function freshStore(): Promise<DeviceStore> {
  dbCount += 1;
  const opened = await openDeviceStore(`server-log-${String(dbCount)}`);
  if (opened.status !== "ready") {
    throw new Error("store not ready");
  }
  return opened.store;
}

// Taken before the timers are faked: IndexedDB runs on real tasks, the protocol's timers don't.
const realSetTimeout = globalThis.setTimeout;

async function tick(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  }
}

interface Ipad {
  readonly log: ServerLog;
  readonly store: DeviceStore;
  readonly changes: LogChange[];
  connection(): string | undefined;
}

async function connectIpad(
  server: FakeSyncServer,
  store?: DeviceStore,
  settings = SETTINGS,
): Promise<Ipad> {
  const mirror = store ?? (await freshStore());
  const log = createServerLog({
    mirror,
    settings,
    fetch: server.fetch,
    openStream: server.openStream,
  });
  const changes: LogChange[] = [];
  log.subscribe((change) => changes.push(change));
  log.start();
  await tick();
  return {
    log,
    store: mirror,
    changes,
    connection() {
      const last = changes.filter((c) => c.kind === "connection").at(-1);
      return last?.connection;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Verbinden test", () => {
  it("reports the server's event count", async () => {
    const server = createFakeSyncServer();
    server.replace([event(1), event(2)], "iPad 1", "push");
    expect(await testServer(SETTINGS, server.fetch)).toEqual({
      kind: "ok",
      eventCount: 2,
      certExpiresAt: null,
    });
  });

  it.each([
    [
      "a wrong pairing code",
      { ...SETTINGS, pairingCode: "WRONG234" },
      "pairingCode",
    ],
    ["an unreachable server", SETTINGS, "unreachable"],
  ])("tells %s apart", async (_, settings, kind) => {
    const server = createFakeSyncServer();
    if (kind === "unreachable") {
      server.goOffline();
    }
    expect(await testServer(settings, server.fetch)).toEqual({ kind });
  });

  it("refuses a server whose log is of another format", async () => {
    const server = createFakeSyncServer();
    server.replace([], "iPad 1", "newFest", FORMAT_VERSION + 1);
    expect(await testServer(SETTINGS, server.fetch)).toEqual({
      kind: "version",
    });
  });
});

describe("connect-time comparison", () => {
  // server-sync 02
  it("catches a fresh iPad up silently", async () => {
    const server = createFakeSyncServer();
    server.replace([event(1), event(2)], "iPad 1", "push");
    const ipad = await connectIpad(server);
    expect(ipad.connection()).toBe("connected");
    expect(await ipad.store.load()).toEqual([event(1), event(2)]);
    expect(await ipad.store.meta()).toMatchObject({
      logId: server.logId,
      serverSeq: 2,
    });
    expect(ipad.changes.some((c) => c.kind === "decide")).toBe(false);
  });

  it("connects silently to a server holding the same log", async () => {
    const server = createFakeSyncServer();
    server.replace([event(1)], "iPad 1", "push");
    const store = await freshStore();
    await store.append(event(1));
    const ipad = await connectIpad(server, store);
    expect(ipad.connection()).toBe("connected");
    expect((await store.meta()).logId).toBe(server.logId);
  });

  // server-sync 02: the recovery after a standalone fallback
  it("pushes what the server is missing, one by one, keeping its log", async () => {
    const server = createFakeSyncServer();
    server.replace([event(1)], "iPad 1", "push");
    const logId = server.logId;
    const store = await freshStore();
    await store.append(event(1));
    await store.append(event(2));
    await store.append(event(3));
    const ipad = await connectIpad(server, store);
    expect(ipad.connection()).toBe("connected");
    expect(server.events).toEqual([event(1), event(2), event(3)]);
    expect(server.logId).toBe(logId);
    expect(server.requests("POST /log/events")).toBe(2);
    expect(await store.meta()).toMatchObject({ logId, serverSeq: 3 });
  });

  // server-sync 02: an empty log the mirror already belongs to is only a prefix
  it("pushes silently to its own log when that log is still empty", async () => {
    const server = createFakeSyncServer();
    const store = await freshStore();
    const ipad = await connectIpad(server, store);
    ipad.log.close();
    await store.append(event(1));
    const again = await connectIpad(server, store);
    expect(again.changes.some((c) => c.kind === "decide")).toBe(false);
    expect(again.connection()).toBe("connected");
    expect(server.events).toEqual([event(1)]);
  });

  it("asks before uploading to an empty server, and uploads on Hochladen", async () => {
    const server = createFakeSyncServer();
    const store = await freshStore();
    await store.append(event(1));
    const ipad = await connectIpad(server, store);
    expect(ipad.changes.at(-1)).toEqual({
      kind: "decide",
      question: { kind: "serverEmpty", localCount: 1 },
    });
    expect(ipad.connection()).toBe("connecting");

    expect(await ipad.log.pushLocal()).toEqual({ kind: "replaced" });
    await tick();
    expect(server.events).toEqual([event(1)]);
    expect(ipad.connection()).toBe("connected");
    expect((await store.meta()).logId).toBe(server.logId);
    // The first push shows nothing on the other iPads either.
    expect(
      ipad.changes.filter((c) => c.kind === "replaced" && c.by !== undefined),
    ).toEqual([]);
  });

  it("asks before replacing a diverged mirror, and replaces it on request", async () => {
    const server = createFakeSyncServer();
    server.replace([event(1, "server")], "iPad 1", "push");
    const store = await freshStore();
    await store.append(event(1));
    await store.append(event(2));
    const ipad = await connectIpad(server, store);
    expect(ipad.changes.at(-1)).toEqual({
      kind: "decide",
      question: { kind: "diverged", localCount: 2, serverCount: 1 },
    });

    await ipad.log.adoptServer();
    await tick();
    expect(await store.load()).toEqual([event(1, "server")]);
    expect(ipad.connection()).toBe("connected");
  });
});

describe("appending in sync mode", () => {
  it("counts a tap once the server has it, and shows it on the other iPad", async () => {
    const server = createFakeSyncServer();
    const first = await connectIpad(server);
    const second = await connectIpad(server);
    const result = first.log.append({ ...event(1), device: "iPad 2" });
    await tick();
    expect(await result).toEqual({ kind: "appended" });
    expect(server.events).toHaveLength(1);
    expect(await first.store.load()).toHaveLength(1);
    expect(second.changes).toContainEqual({
      kind: "appended",
      events: [{ ...event(1), device: "iPad 2" }],
    });
    expect(await second.store.load()).toHaveLength(1);
    expect((await second.store.meta()).serverSeq).toBe(1);
  });

  // server-sync 02: stale 409, same log
  it("reports a clash with the events the other iPad appended first", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    server.goSilent();
    server.appendFromOtherIpad(event(1, "other"));
    server.comeBack();
    const result = ipad.log.append(event(1));
    await tick();
    expect(await result).toEqual({
      kind: "stale",
      missed: [event(1, "other")],
    });
    expect(await ipad.store.load()).toEqual([event(1, "other")]);
  });

  it("drops a tap made on a log the server has replaced", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    server.goSilent();
    server.replace([], "iPad 1", "newFest");
    server.comeBack();
    const result = ipad.log.append(event(1));
    await tick();
    expect(await result).toEqual({ kind: "dropped" });
    expect(server.events).toEqual([]);
  });

  // server-sync 02: no reply
  it("retries once after 4 s, then blocks until the reconnect settles the tap that landed", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    server.dropNextReply("POST /log/events", 2);
    let settled: unknown = null;
    void ipad.log.append(event(1)).then((result) => {
      settled = result;
    });
    await tick();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(server.requests("POST /log/events")).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await tick();
    expect(server.requests("POST /log/events")).toBe(2);
    await vi.advanceTimersByTimeAsync(4_000);
    await tick();
    expect(ipad.connection()).toBe("disconnected");
    expect(settled).toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    await tick();
    expect(ipad.connection()).toBe("connected");
    expect(settled).toEqual({ kind: "appended" });
    expect(server.requests("POST /log/events")).toBe(2);
    expect(server.events).toHaveLength(1);
    expect(await ipad.store.load()).toEqual([event(1)]);
  });

  it("makes one normal attempt after the reconnect when the tap never landed", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    server.goOffline();
    await tick();
    expect(ipad.connection()).toBe("disconnected");
    // Taps are disabled while disconnected; a tap already on its way stays pending.
    server.comeBack();
    await vi.advanceTimersByTimeAsync(1_000);
    await tick();
    expect(ipad.connection()).toBe("connected");
    server.goOffline();
    const result = ipad.log.append(event(1));
    await tick();
    expect(ipad.connection()).toBe("disconnected");
    server.comeBack();
    await vi.advanceTimersByTimeAsync(2_000);
    await tick();
    expect(await result).toEqual({ kind: "appended" });
    expect(server.events).toEqual([event(1)]);
  });

  it("drops a pending tap on Trennen", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    server.dropNextReply("POST /log/events", 2);
    const result = ipad.log.append(event(1));
    await tick();
    ipad.log.close();
    expect(await result).toEqual({ kind: "dropped" });
  });
});

describe("the live channel", () => {
  // server-sync 02: 25 s watchdog, backoff 1/2/5/10 s
  it("goes disconnected after 25 s of silence and retries with backoff", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    server.goSilent();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(ipad.connection()).toBe("connected");
    await vi.advanceTimersByTimeAsync(1);
    expect(ipad.connection()).toBe("disconnected");

    const handshakes = server.requests("GET /log");
    for (const wait of [1_000, 2_000, 5_000, 10_000, 10_000]) {
      const before = server.requests("GET /log");
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(server.requests("GET /log")).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      await tick();
      expect(server.requests("GET /log")).toBe(before + 1);
      // Silent again: the attempt hears no `log` message and times out.
      await vi.advanceTimersByTimeAsync(25_000);
    }
    expect(server.requests("GET /log")).toBe(handshakes + 5);

    server.comeBack();
    await vi.advanceTimersByTimeAsync(10_000);
    await tick();
    expect(ipad.connection()).toBe("connected");
  });

  it("stays connected through the pings", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ipad.connection()).toBe("connected");
  });

  it("catches up on what it missed while disconnected", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    server.goOffline();
    await tick();
    server.comeBack();
    server.goSilent();
    server.appendFromOtherIpad(event(1, "other"));
    server.comeBack();
    await vi.advanceTimersByTimeAsync(1_000);
    await tick();
    expect(ipad.connection()).toBe("connected");
    expect(await ipad.store.load()).toEqual([event(1, "other")]);
    expect(ipad.changes).toContainEqual({
      kind: "appended",
      events: [event(1, "other")],
    });
  });

  it.each([
    ["pairingCode", { ...SETTINGS, pairingCode: "WRONG234" }, 1],
    ["version", SETTINGS, FORMAT_VERSION + 1],
  ] as const)(
    "stops retrying when rejected for %s",
    async (reason, settings, version) => {
      const server = createFakeSyncServer();
      server.replace([], "iPad 1", "newFest", version);
      const ipad = await connectIpad(server, undefined, settings);
      expect(ipad.changes.at(-1)).toEqual({ kind: "rejected", reason });
      const requests = server.requests("GET /log");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(server.requests("GET /log")).toBe(requests);
    },
  );
});

describe("replacing the log", () => {
  // server-sync 02: following a replacement
  it("follows another iPad's Neues Fest silently, naming it", async () => {
    const server = createFakeSyncServer();
    server.replace([event(1)], "iPad 1", "push");
    const ipad = await connectIpad(server);
    server.replace([], "iPad 1", "newFest");
    await tick();
    const following = ipad.changes.slice(
      ipad.changes.findIndex(
        (c) => c.kind === "connection" && c.connection === "connected",
      ) + 1,
    );
    // Taps stay disabled until the follow is done.
    expect(following[0]).toEqual({
      kind: "connection",
      connection: "connecting",
    });
    expect(ipad.changes).toContainEqual({
      kind: "replaced",
      by: { device: "iPad 1", reason: "newFest" },
    });
    expect(await ipad.store.load()).toEqual([]);
    expect((await ipad.store.meta()).logId).toBe(server.logId);
    expect(ipad.connection()).toBe("connected");
  });

  // server-sync 03: the serverSeq guard
  it("asks instead of following when the mirror holds events the server never saw", async () => {
    const server = createFakeSyncServer();
    server.replace([event(1)], "iPad 1", "push");
    const store = await freshStore();
    const ipad = await connectIpad(server, store);
    ipad.log.close();
    await store.append(event(2));
    server.replace([], "iPad 1", "newFest");

    const again = await connectIpad(server, store);
    expect(again.changes.at(-1)).toEqual({
      kind: "decide",
      question: { kind: "diverged", localCount: 2, serverCount: 0 },
    });
    expect(await store.load()).toHaveLength(2);
  });

  it("imports on the server, and every iPad follows", async () => {
    const server = createFakeSyncServer();
    const first = await connectIpad(server);
    const second = await connectIpad(server);
    expect(await first.log.replace([event(1), event(2)], "import")).toEqual({
      kind: "replaced",
    });
    await tick();
    expect(server.events).toHaveLength(2);
    expect(await first.store.load()).toHaveLength(2);
    expect(first.changes).toContainEqual({ kind: "replaced" });
    expect(
      first.changes.some((c) => c.kind === "replaced" && c.by !== undefined),
    ).toBe(false);
    expect(second.changes).toContainEqual({
      kind: "replaced",
      by: { device: "iPad 2", reason: "import" },
    });
    expect(await second.store.load()).toHaveLength(2);
  });

  it("refuses an unreadable import before sending it", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    await expect(
      ipad.log.replace([{ seq: 1, type: "beerPoured" }], "import"),
    ).rejects.toBeInstanceOf(ImportRejectedError);
    expect(server.requests("PUT /log")).toBe(0);
  });

  it("changes nothing when another iPad replaced the log first", async () => {
    const server = createFakeSyncServer();
    const ipad = await connectIpad(server);
    await ipad.store.append(event(1));
    server.goSilent();
    server.replace([], "iPad 1", "newFest");
    expect(await ipad.log.replace([], "overwrite")).toEqual({
      kind: "conflict",
    });
    expect(await ipad.store.load()).toHaveLength(1);
  });
});
