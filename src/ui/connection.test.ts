import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSyncServer, FORMAT_VERSION } from "../storage/index";
import {
  connectionLabel,
  followToast,
  kitchenDisplayStale,
  nextConnection,
} from "./connection";
import { syncIpad, TEST_SETTINGS, tick } from "./sync-test-ipad";

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

// server-sync 02: the connection transitions; the strip never flickers during backoff
describe("the connection an iPad shows", () => {
  it("goes from Verbinden through connecting to connected", async () => {
    const server = createFakeSyncServer();
    const ipad = await syncIpad(server);
    expect(ipad.connections).toEqual(["connecting", "connected"]);
  });

  it("goes disconnected when the first attempt fails", async () => {
    const server = createFakeSyncServer();
    server.goOffline();
    const ipad = await syncIpad(server);
    expect(ipad.connections).toEqual(["connecting", "disconnected"]);
  });

  it("is rejected for a wrong code or another format, from connecting or disconnected", async () => {
    const server = createFakeSyncServer();
    const wrongCode = await syncIpad(server, {
      ...TEST_SETTINGS,
      pairingCode: "WRONG234",
    });
    expect(wrongCode.connections).toEqual(["connecting", "rejected"]);

    server.goOffline();
    const later = await syncIpad(server);
    server.replace([], "iPad 1", "newFest", FORMAT_VERSION + 1);
    server.comeBack();
    await vi.advanceTimersByTimeAsync(1_000);
    await tick();
    expect(later.connections).toEqual([
      "connecting",
      "disconnected",
      "rejected",
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(later.connection()).toBe("rejected");
  });

  it("goes disconnected on watchdog silence and stays so through backoff until it connects", async () => {
    const server = createFakeSyncServer();
    const ipad = await syncIpad(server);
    server.goSilent();
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(25_000 + 2_000);
    await tick();
    expect(ipad.connection()).toBe("disconnected");
    server.comeBack();
    // The attempt opened while silent times out first, then the next one connects.
    await vi.advanceTimersByTimeAsync(25_000 + 10_000);
    await tick();
    expect(ipad.connections).toEqual([
      "connecting",
      "connected",
      "disconnected",
      "connected",
    ]);
  });

  it("goes disconnected when a tap gets no reply after its retry", async () => {
    const server = createFakeSyncServer();
    const ipad = await syncIpad(server);
    server.dropNextReply("POST /log/events", 2);
    void ipad.log.append({
      id: "a",
      seq: 1,
      at: 1,
      type: "pagerMarkedMissing",
      pager: 3,
    });
    await tick();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(ipad.connection()).toBe("disconnected");
  });

  it("shows connecting when the app comes back visible while connected", () => {
    expect(
      nextConnection("connected", {
        kind: "connection",
        connection: "connecting",
      }),
    ).toBe("connecting");
    expect(
      nextConnection("disconnected", {
        kind: "connection",
        connection: "connecting",
      }),
    ).toBe("disconnected");
  });

  it("goes standalone on Trennen from every sync state", async () => {
    const server = createFakeSyncServer();
    const ipad = await syncIpad(server);
    ipad.disconnect();
    expect(ipad.connection()).toBe("standalone");
    for (const from of [
      "connecting",
      "connected",
      "disconnected",
      "rejected",
    ] as const) {
      expect(nextConnection(from, { kind: "disconnect" })).toBe("standalone");
    }
  });

  it("ignores a late change once standalone", () => {
    expect(
      nextConnection("standalone", {
        kind: "connection",
        connection: "connected",
      }),
    ).toBe("standalone");
  });
});

describe("the header's connection status", () => {
  it.each([
    ["standalone", null, "Eigenständig"],
    ["connected", null, "● Verbunden als Annahme"],
    ["connecting", null, "Verbinde…"],
    ["disconnected", null, "○ Keine Verbindung"],
    ["rejected", "pairingCode", "○ Kopplungscode falsch"],
    ["rejected", "version", "○ Version passt nicht"],
  ] as const)("reads %s (%s) as “%s”", (connection, reason, label) => {
    expect(connectionLabel(connection, reason, "Annahme")).toBe(label);
  });
});

describe("the toast on a following iPad", () => {
  it.each([
    ["newFest", "Neues Fest auf „Annahme“ gestartet"],
    ["import", "Protokoll von „Annahme“ importiert"],
    ["overwrite", "Server von „Annahme“ überschrieben"],
  ] as const)("names who did %s", (reason, text) => {
    expect(followToast({ device: "Annahme", reason })).toBe(text);
  });
});

describe("the Küchenanzeige's numbers", () => {
  it("are live only while connected", () => {
    expect(kitchenDisplayStale("connected", null, false)).toBeNull();
  });

  // Nobody at the kitchen answers the server's question: staff end the Küchenanzeige and answer it.
  it("go stale while the server waits for an answer", () => {
    expect(kitchenDisplayStale("connecting", null, true)).toBe(
      "Rückfrage vom Server – Küchenanzeige beenden (lange drücken)",
    );
  });

  it.each([
    ["connecting", null, "Verbinde… – Zahlen veraltet"],
    ["disconnected", null, "Keine Verbindung – Zahlen veraltet"],
    ["standalone", null, "Keine Verbindung – Zahlen veraltet"],
    ["rejected", "pairingCode", "Kopplungscode falsch – Zahlen veraltet"],
    ["rejected", "version", "Version passt nicht – Zahlen veraltet"],
  ] as const)("go stale when %s (%s)", (connection, reason, banner) => {
    expect(kitchenDisplayStale(connection, reason, false)).toBe(banner);
  });
});
