import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Event } from "../core/index";
import { FORMAT_VERSION, ImportRejectedError, openDeviceStore } from "./index";

let dbCount = 0;
function freshName(): string {
  dbCount += 1;
  return `kirbe-pager-test-${String(dbCount)}`;
}

function event(seq: number, body: Partial<Event> = {}): Event {
  return {
    id: `id-${String(seq)}`,
    seq,
    at: 1_000 * seq,
    type: "pagerMarkedMissing",
    pager: seq,
    ...body,
  } as Event;
}

async function readyStore(name = freshName()) {
  const opened = await openDeviceStore(name);
  if (opened.status !== "ready") {
    throw new Error("store not ready");
  }
  return opened.store;
}

async function seedFormatVersion(name: string, formatVersion: unknown) {
  const store = await readyStore(name);
  await store.append(event(1));
  store.close();
  const request = indexedDB.open(name);
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const tx = request.result.transaction("meta", "readwrite");
      tx.objectStore("meta").put(formatVersion, "formatVersion");
      tx.oncomplete = () => {
        request.result.close();
        resolve();
      };
      tx.onerror = () => {
        reject(new Error("seed failed"));
      };
    };
  });
}

describe("the event log on the device", () => {
  it("starts empty", async () => {
    const store = await readyStore();
    expect(await store.load()).toEqual([]);
    expect(await store.meta()).toEqual({
      formatVersion: FORMAT_VERSION,
      eventCount: 0,
    });
  });

  it("loads appended events back in seq order, after a reopen", async () => {
    const name = freshName();
    const store = await readyStore(name);
    await store.append(event(1));
    await store.append(event(2));
    await store.append(event(10));
    store.close();

    const reopened = await readyStore(name);
    expect((await reopened.load()).map((e) => e.seq)).toEqual([1, 2, 10]);
    expect((await reopened.meta()).eventCount).toBe(3);
  });

  it("refuses to append an event whose seq is already in the log", async () => {
    const store = await readyStore();
    await store.append(event(1));
    await expect(store.append(event(1, { id: "other" }))).rejects.toThrow();
    expect(await store.load()).toHaveLength(1);
  });

  it("remembers the last export time and the persist() result", async () => {
    const name = freshName();
    const store = await readyStore(name);
    await store.recordExport(42_000);
    await store.recordPersisted(true);
    store.close();
    expect(await (await readyStore(name)).meta()).toEqual({
      formatVersion: FORMAT_VERSION,
      eventCount: 0,
      lastExportAt: 42_000,
      persisted: true,
    });
  });

  // spec, "Storage": a build that can't read the stored log never wipes it
  it("refuses to start on a log whose format version this build can't read, and keeps it", async () => {
    const name = freshName();
    await seedFormatVersion(name, FORMAT_VERSION + 1);
    const opened = await openDeviceStore(name);
    expect(opened.status).toBe("unreadable");
    const file = await opened.store.exportFile(5_000);
    expect(file).toMatchObject({
      formatVersion: FORMAT_VERSION + 1,
      events: [expect.objectContaining({ seq: 1 })],
    });
  });
});

describe("a log this build can't read", () => {
  // spec, "Storage": never wipe the log
  it("refuses to start on a stored record that is not an event, and keeps it", async () => {
    const name = freshName();
    const store = await readyStore(name);
    await store.append(event(1));
    store.close();
    const request = indexedDB.open(name);
    await new Promise<void>((resolve) => {
      request.onsuccess = () => {
        const tx = request.result.transaction("events", "readwrite");
        tx.objectStore("events").put({ seq: 2, garbage: true });
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
    });
    const opened = await openDeviceStore(name);
    expect(opened.status).toBe("unreadable");
    expect((await opened.store.exportFile(1)).events).toHaveLength(2);
  });

  it("refuses to start on a stored log whose events don't fold", async () => {
    const name = freshName();
    const store = await readyStore(name);
    await store.append(event(1, { type: "pagerRestored" }));
    store.close();
    expect((await openDeviceStore(name)).status).toBe("unreadable");
  });

  it("opens a database a newer build upgraded, for export only", async () => {
    const name = freshName();
    const store = await readyStore(name);
    await store.append(event(1));
    store.close();
    const request = indexedDB.open(name, 5);
    await new Promise<void>((resolve) => {
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    const opened = await openDeviceStore(name);
    expect(opened.status).toBe("unreadable");
    expect((await opened.store.exportFile(1)).events).toHaveLength(1);
  });
});

describe("export and import", () => {
  it("reproduces the log in another store", async () => {
    const source = await readyStore();
    await source.append(event(1));
    await source.append(event(2));
    const file = JSON.parse(
      JSON.stringify(await source.exportFile(9_000)),
    ) as unknown;
    expect(file).toMatchObject({
      app: "kirbe-pager",
      formatVersion: FORMAT_VERSION,
      exportedAt: 9_000,
    });

    const target = await readyStore();
    await target.importFile(file);
    expect(await target.load()).toEqual(await source.load());
  });

  it("replaces the whole log on import", async () => {
    const source = await readyStore();
    await source.append(event(1));
    const file = await source.exportFile(9_000);

    const target = await readyStore();
    await target.append(event(1, { id: "x", pager: 20 }));
    await target.append(event(2, { id: "y", pager: 21 }));
    await target.importFile(file);
    expect(await target.load()).toEqual([event(1)]);
  });

  it("rejects a file of a format version this build can't read and leaves the log unchanged", async () => {
    const store = await readyStore();
    await store.append(event(1));
    const file = {
      ...(await store.exportFile(9_000)),
      formatVersion: FORMAT_VERSION + 1,
      events: [],
    };
    await expect(store.importFile(file)).rejects.toBeInstanceOf(
      ImportRejectedError,
    );
    expect(await store.load()).toEqual([event(1)]);
  });

  // server-sync 03: builds before and after sync read each other's logs
  it("imports events that carry the iPad's device name", async () => {
    const store = await readyStore();
    const file = {
      app: "kirbe-pager",
      formatVersion: FORMAT_VERSION,
      exportedAt: 1,
      events: [event(1, { device: "Annahme" }), { ...event(2), future: 1 }],
    };
    await store.importFile(file);
    expect((await store.load())[0]?.device).toBe("Annahme");
  });

  it.each<[string, unknown]>([
    ["not an export", { hello: "world" }],
    [
      "an event of unknown type",
      {
        app: "kirbe-pager",
        formatVersion: FORMAT_VERSION,
        events: [{ seq: 1, id: "a", at: 1, type: "beerPoured" }],
      },
    ],
    [
      "an event whose device is not a name",
      {
        app: "kirbe-pager",
        formatVersion: FORMAT_VERSION,
        events: [{ ...event(1), device: 2 }],
      },
    ],
    [
      "events that break an invariant",
      {
        app: "kirbe-pager",
        formatVersion: FORMAT_VERSION,
        events: [event(1, { type: "pagerRestored" })],
      },
    ],
  ])("rejects %s and leaves the log unchanged", async (_, file) => {
    const store = await readyStore();
    await store.append(event(1));
    await expect(store.importFile(file)).rejects.toBeInstanceOf(
      ImportRejectedError,
    );
    expect(await store.load()).toEqual([event(1)]);
  });

  it("makes an unreadable log readable again by importing a readable file", async () => {
    const source = await readyStore();
    await source.append(event(1));
    const file = await source.exportFile(9_000);

    const name = freshName();
    await seedFormatVersion(name, FORMAT_VERSION + 1);
    const opened = await openDeviceStore(name);
    await opened.store.importFile(file);
    opened.store.close();
    const reopened = await readyStore(name);
    expect(await reopened.load()).toEqual([event(1)]);
  });
});

describe("Neues Fest starten", () => {
  it("empties the log and resets meta, keeping the format version", async () => {
    const name = freshName();
    const store = await readyStore(name);
    await store.append(event(1));
    await store.recordExport(42_000);
    await store.recordPersisted(true);
    await store.clear();
    store.close();

    const reopened = await readyStore(name);
    expect(await reopened.load()).toEqual([]);
    expect(await reopened.meta()).toEqual({
      formatVersion: FORMAT_VERSION,
      eventCount: 0,
    });
  });
});

describe("the mirror and the server settings", () => {
  const settings = {
    serverAddress: "kirbe.example.de",
    pairingCode: "ABCD2345",
    deviceName: "Annahme",
  };

  it("appends standalone and never reports a change", async () => {
    const store = await readyStore();
    const changes: unknown[] = [];
    store.subscribe((change) => changes.push(change));
    expect(await store.append(event(1))).toEqual({ kind: "appended" });
    expect(changes).toEqual([]);
  });

  it("keeps the settings in meta, outside the event log and the export", async () => {
    const name = freshName();
    const store = await readyStore(name);
    await store.saveSettings(settings);
    store.close();
    const reopened = await readyStore(name);
    expect(await reopened.meta()).toMatchObject(settings);
    expect(await reopened.load()).toEqual([]);
    expect(Object.keys(await reopened.exportFile(1))).toEqual([
      "app",
      "formatVersion",
      "exportedAt",
      "events",
    ]);
  });

  // server-sync 03: Trennen clears only the address
  it("forgets only the address on Trennen", async () => {
    const store = await readyStore();
    await store.saveSettings(settings);
    await store.recordFromServer([event(1)], "log-1", 1);
    await store.clearServerAddress();
    const meta = await store.meta();
    expect(meta.serverAddress).toBeUndefined();
    expect(meta).toMatchObject({
      pairingCode: "ABCD2345",
      deviceName: "Annahme",
      logId: "log-1",
      serverSeq: 1,
    });
  });

  it("records events from the server with the log and the server's seq", async () => {
    const store = await readyStore();
    await store.recordFromServer([event(1), event(2)], "log-1", 2);
    await store.recordFromServer([], "log-1", 2);
    expect((await store.load()).map((e) => e.seq)).toEqual([1, 2]);
    expect(await store.meta()).toMatchObject({ logId: "log-1", serverSeq: 2 });
  });

  it("replaces the log with a server's, or with a standalone one", async () => {
    const store = await readyStore();
    await store.append(event(1));
    await store.replaceLog([event(1, { id: "s" }), event(2)], "log-2");
    expect((await store.load()).map((e) => e.id)).toEqual(["s", "id-2"]);
    expect(await store.meta()).toMatchObject({ logId: "log-2", serverSeq: 2 });

    await store.replaceLog([], null);
    const meta = await store.meta();
    expect(meta.logId).toBeUndefined();
    expect(meta.serverSeq).toBeUndefined();
  });

  it("keeps the connection settings on Neues Fest starten", async () => {
    const store = await readyStore();
    await store.saveSettings(settings);
    await store.recordFromServer([event(1)], "log-1", 1);
    await store.recordExport(5);
    await store.clear();
    expect(await store.meta()).toEqual({
      formatVersion: FORMAT_VERSION,
      eventCount: 0,
      ...settings,
    });
  });
});
