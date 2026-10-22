import { vi } from "vitest";
import { createServerLog, openDeviceStore } from "../storage/index";
import type {
  DeviceStore,
  FakeSyncServer,
  LogChange,
  ServerLog,
  SyncSettings,
} from "../storage/index";
import { nextConnection } from "./connection";
import type { Connection } from "./connection";

/** Test helper: an iPad in sync mode over the fake server, its connection as the hook keeps it. */
export interface TestIpad {
  readonly log: ServerLog;
  readonly store: DeviceStore;
  readonly changes: LogChange[];
  /** Every connection the hook would have shown, in order. */
  readonly connections: Connection[];
  connection(): Connection;
  disconnect(): void;
}

export const TEST_SETTINGS: SyncSettings = {
  serverAddress: "kirbe.example.de",
  pairingCode: "ABCD2345",
  deviceName: "iPad 2",
};

// Taken before the timers are faked: IndexedDB runs on real tasks, the protocol's timers don't.
const realSetTimeout = globalThis.setTimeout;

export async function tick(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  }
}

let dbCount = 0;

export async function syncIpad(
  server: FakeSyncServer,
  settings: SyncSettings = TEST_SETTINGS,
): Promise<TestIpad> {
  dbCount += 1;
  const opened = await openDeviceStore(`ui-sync-${String(dbCount)}`);
  const store = opened.store;
  const log = createServerLog({
    mirror: store,
    settings,
    fetch: server.fetch,
    openStream: server.openStream,
  });
  const changes: LogChange[] = [];
  let connection: Connection = nextConnection("standalone", {
    kind: "connect",
  });
  const connections: Connection[] = [connection];
  function step(change: Parameters<typeof nextConnection>[1]): void {
    const next = nextConnection(connection, change);
    if (next !== connection) {
      connections.push(next);
    }
    connection = next;
  }
  log.subscribe((change) => {
    changes.push(change);
    step(change);
  });
  log.start();
  await tick();
  return {
    log,
    store,
    changes,
    connections,
    connection() {
      return connection;
    },
    disconnect() {
      log.close();
      step({ kind: "disconnect" });
    },
  };
}
