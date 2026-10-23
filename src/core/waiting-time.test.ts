import { describe, expect, it } from "vitest";
import { evaluationRows, fold, orderView } from "./index";
import type { State } from "./index";
import { testLog } from "./test-log";

const MINUTE = 60_000;

function averageFor(state: State, productId: string): number | undefined {
  return evaluationRows(state).find((r) => r.productId === productId)
    ?.averageWaitingTimeMs;
}

// #3
describe("the waiting time in the Auswertung", () => {
  it("averages the waiting time of every picked-up plate, from intake to its handover", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 2 }],
    });
    log.wait(5 * MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(8 * MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(9 * MINUTE);
  });

  it("counts each plate of one handover as its own entry", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 2 }],
    });
    log.wait(2 * MINUTE);
    const nine = log.add({
      type: "orderTaken",
      pager: 9,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(4 * MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 2 }],
    });
    log.add({
      type: "platesHandedOver",
      orderId: nine.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    // (6 + 6 + 4) / 3 minutes
    expect(averageFor(fold(log.events), "flammkuchen")).toBe((16 * MINUTE) / 3);
  });

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

  it("leaves out cancelled and abandoned plates", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 3 }],
    });
    const nine = log.add({
      type: "orderTaken",
      pager: 9,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(3 * MINUTE);
    log.add({
      type: "platesCancelled",
      orderId: seven.id,
      productId: "flammkuchen",
      count: 1,
    });
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 2 }],
    });
    log.wait(30 * MINUTE);
    log.add({
      type: "platesBuzzed",
      orderId: nine.id,
      productId: "flammkuchen",
      count: 1,
    });
    log.add({ type: "orderAbandoned", orderId: nine.id, pagerBack: true });
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(3 * MINUTE);
  });

  it("keeps a plate sent back to queue waiting until its replacement is picked up", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(4 * MINUTE);
    log.add({
      type: "platesBuzzed",
      orderId: seven.id,
      productId: "flammkuchen",
      count: 1,
    });
    log.add({
      type: "plateSentBackToQueue",
      orderId: seven.id,
      productId: "flammkuchen",
    });
    log.wait(7 * MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(11 * MINUTE);
  });

  it("forgets a handover that was undone", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(4 * MINUTE);
    const handover = log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.add({ type: "actionUndone", targetId: handover.id });
    expect(averageFor(fold(log.events), "flammkuchen")).toBeUndefined();
  });

  it("has no average for a product nobody picked up", () => {
    expect(averageFor(fold([]), "flammkuchen")).toBeUndefined();
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

// #3
describe("the waiting time in the order popup", () => {
  it("runs from intake to now, through a partial handover", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 2 }],
    });
    log.wait(5 * MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(7 * MINUTE);
    expect(orderView(fold(log.events), seven.id, log.now)?.waitingTimeMs).toBe(
      12 * MINUTE,
    );
  });

  it("never shows a waiting time below zero", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    expect(
      orderView(fold(log.events), seven.id, log.now - MINUTE)?.waitingTimeMs,
    ).toBe(0);
  });
});
