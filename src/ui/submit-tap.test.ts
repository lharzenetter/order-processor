import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fold } from "../core/index";
import type { EventBody } from "../core/index";
import { createFakeSyncServer, openDeviceStore } from "../storage/index";
import type { Fetch } from "../storage/index";
import { submitTap } from "./submit-tap";
import { syncIpad, tick } from "./sync-test-ipad";

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
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

const ORDER: EventBody = {
  type: "orderTaken",
  pager: 7,
  plates: [{ productId: "braten", count: 1 }],
};

function buzz(orderId: string): EventBody {
  return { type: "platesBuzzed", orderId, productId: "braten", count: 1 };
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  await tick();
  return promise;
}

describe("a tap", () => {
  it("appends standalone with the stamp it was given", async () => {
    const opened = await openDeviceStore("submit-tap-standalone");
    const result = await submitTap(opened.store, fold([]), ORDER, {
      id: "a",
      seq: 1,
    });
    expect(result).toEqual({
      kind: "appended",
      events: [{ ...ORDER, id: "a", seq: 1, at: 1_000_000 }],
    });
  });

  it("carries the device name in sync mode", async () => {
    const server = createFakeSyncServer();
    const ipad = await syncIpad(server);
    const result = await settle(
      submitTap(ipad.log, fold([]), ORDER, {
        id: "a",
        seq: 1,
        device: "iPad 2",
      }),
    );
    expect(result.kind).toBe("appended");
    expect(server.events).toEqual([
      { ...ORDER, id: "a", seq: 1, at: 1_000_000, device: "iPad 2" },
    ]);
  });

  // server-sync 02: a stale tap is re-checked with the same id, the next seq and a fresh at
  it("is re-checked and applied after the other iPad's tap", async () => {
    const server = createFakeSyncServer();
    const ipad = await syncIpad(server);
    server.goSilent();
    server.appendFromOtherIpad({ ...ORDER, id: "other", at: 5 });
    server.comeBack();
    vi.setSystemTime(2_000_000);
    const result = await settle(
      submitTap(
        ipad.log,
        fold([]),
        { ...ORDER, pager: 8 },
        { id: "a", seq: 1 },
      ),
    );
    expect(result).toEqual({
      kind: "appended",
      events: [
        { ...ORDER, id: "other", seq: 1, at: 5 },
        { ...ORDER, pager: 8, id: "a", seq: 2, at: 2_000_000 },
      ],
    });
  });

  it("is refused as Inzwischen geändert when the other iPad's tap made it impossible", async () => {
    const server = createFakeSyncServer();
    server.replace([{ ...ORDER, id: "o", seq: 1, at: 1 }], "iPad 1", "push");
    const ipad = await syncIpad(server);
    const state = fold(await ipad.store.load());
    server.goSilent();
    server.appendFromOtherIpad({ ...buzz("o"), id: "other", at: 5 });
    server.comeBack();
    const result = await settle(
      submitTap(ipad.log, state, buzz("o"), { id: "a", seq: 2 }),
    );
    expect(result).toEqual({
      kind: "changed",
      events: [{ ...buzz("o"), id: "other", seq: 2, at: 5 }],
    });
    expect(server.events).toHaveLength(2);
  });

  it("gives up after the third lost round", async () => {
    const server = createFakeSyncServer();
    let other = 0;
    // Another iPad wins the race before every one of this iPad's appends.
    const racing: Fetch = (input, init) => {
      if (init?.method === "POST") {
        other += 1;
        server.goSilent();
        server.appendFromOtherIpad({
          type: "pagerMarkedMissing",
          pager: 20 + other,
          id: `other-${String(other)}`,
          at: 1,
        });
        server.comeBack();
      }
      return server.fetch(input, init);
    };
    const ipad = await syncIpad({ ...server, fetch: racing });
    const result = await settle(
      submitTap(ipad.log, fold([]), ORDER, { id: "a", seq: 1 }),
    );
    expect(result.kind).toBe("changed");
    expect(other).toBe(3);
    expect(server.events.map((e) => (e as { id: string }).id)).toEqual([
      "other-1",
      "other-2",
      "other-3",
    ]);
  });

  it("is dropped when the log is replaced under it", async () => {
    const server = createFakeSyncServer();
    const ipad = await syncIpad(server);
    server.goSilent();
    server.replace([], "iPad 1", "newFest");
    server.comeBack();
    const result = await settle(
      submitTap(ipad.log, fold([]), ORDER, { id: "a", seq: 1 }),
    );
    expect(result).toEqual({ kind: "dropped" });
  });
});
