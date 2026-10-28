import { describe, expect, it } from "vitest";
import { evaluationRows, fold, orderView } from "./index";
import type { Event, State } from "./index";
import { testLog } from "./test-log";
import type { TestLog } from "./test-log";

const MINUTE = 60_000;

function averageFor(state: State, productId: string): number | undefined {
  return evaluationRows(state).find((r) => r.productId === productId)
    ?.averagePickupTimeMs;
}

function takeOrder(log: TestLog, pager: number, count: number): Event {
  return log.add({
    type: "orderTaken",
    pager,
    plates: [{ productId: "flammkuchen", count }],
  });
}

describe("the pickup time in the Auswertung", () => {
  it("never counts a pickup time below zero when another iPad's clock is behind", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 1);
    log.add({
      type: "platesBuzzed",
      orderId: seven.id,
      productId: "flammkuchen",
      count: 1,
    });
    log.wait(-MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(0);
  });
});

describe("the pickup time in the order popup", () => {
  it("is absent on a line with nothing buzzed", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 1);
    expect(
      orderView(fold(log.events), seven.id, log.now)?.lines[0]?.pickupTimeMs,
    ).toBeUndefined();
  });
});
