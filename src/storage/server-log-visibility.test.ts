// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeSyncServer } from "./fake-sync-server";
import { openDeviceStore } from "./index";
import type { LogChange } from "./index";
import { createServerLog } from "./server-log";

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

// Taken before the timers are faked: IndexedDB runs on real tasks, the protocol's timers don't.
const realSetTimeout = globalThis.setTimeout;

async function tick(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  }
}

// server-sync 02: on visibilitychange to visible it reconnects at once
it("reopens the stream at once when the app comes back to the foreground", async () => {
  const server = createFakeSyncServer();
  const opened = await openDeviceStore("server-log-visibility");
  const log = createServerLog({
    mirror: opened.store,
    settings: {
      serverAddress: "kirbe.example.de",
      pairingCode: "ABCD2345",
      deviceName: "iPad 1",
    },
    fetch: server.fetch,
    openStream: server.openStream,
  });
  const changes: LogChange[] = [];
  log.subscribe((change) => changes.push(change));
  log.start();
  await tick();
  const handshakes = server.requests("GET /log");

  document.dispatchEvent(new Event("visibilitychange"));
  expect(changes.at(-1)).toEqual({
    kind: "connection",
    connection: "connecting",
  });
  await tick();
  expect(server.requests("GET /log")).toBeGreaterThan(handshakes);
  expect(changes.at(-1)).toEqual({
    kind: "connection",
    connection: "connected",
  });
  log.close();
});
