import { describe, expect, it } from "vitest";
import { evaluationRows, fold, orderView } from "./index";
import type { Event, State } from "./index";
import { testLog } from "./test-log";
import type { TestLog } from "./test-log";

const MINUTE = 60_000;

function averageFor(state: State, productId: string): number | undefined {
  return evaluationRows(state).find((r) => r.productId === productId)
    ?.averageWaitingTimeMs;
}

function buzz(log: TestLog, order: Event, count: number): void {
  log.add({
    type: "platesBuzzed",
    orderId: order.id,
    productId: "flammkuchen",
    count,
  });
}

// #3
describe("the waiting time in the Auswertung", () => {
  it("rounds the average to whole seconds", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 2 }],
    });
    log.wait(1_000);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(1_001);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    // (1.0 s + 2.001 s) / 2 = 1.5005 s
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(2_000);
  });

  it("never counts a waiting time below zero when another iPad's clock is behind", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 2 }],
    });
    log.wait(-MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(5 * MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    // (0 + 4) / 2 minutes
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(2 * MINUTE);
  });
});

describe("the waiting time in the order popup", () => {
  it("is absent on a line with every plate buzzed", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    buzz(log, seven, 1);
    expect(
      orderView(fold(log.events), seven.id, log.now)?.lines[0]?.waitingTimeMs,
    ).toBeUndefined();
  });

  it("never shows a waiting time below zero", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    expect(
      orderView(fold(log.events), seven.id, log.now - MINUTE)?.lines[0]
        ?.waitingTimeMs,
    ).toBe(0);
  });
});
