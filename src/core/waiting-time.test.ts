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
  it("averages the waiting time of every plate, from intake to its buzz", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 2 }],
    });
    log.wait(5 * MINUTE);
    buzz(log, seven, 1);
    log.wait(3 * MINUTE);
    buzz(log, seven, 1);
    log.wait(10 * MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 2 }],
    });
    // (5 + 8) / 2 minutes
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(6.5 * MINUTE);
  });

  it("runs until the handover for a plate that was never buzzed", () => {
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

  it("is not ended by a re-buzz", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(10 * MINUTE);
    buzz(log, seven, 1);
    log.wait(5 * MINUTE);
    log.add({ type: "rebuzzed", orderId: seven.id, productId: "flammkuchen" });
    log.wait(2 * MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(10 * MINUTE);
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

  it("counts an abandoned plate up to its buzz, and leaves out cancelled plates", () => {
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
    // (3 + 3 + 33) / 3 minutes
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(13 * MINUTE);
  });

  it("keeps a plate sent back to queue waiting until its replacement is buzzed", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(5 * MINUTE);
    buzz(log, seven, 1);
    log.wait(3 * MINUTE);
    log.add({
      type: "plateSentBackToQueue",
      orderId: seven.id,
      productId: "flammkuchen",
    });
    log.wait(6 * MINUTE);
    buzz(log, seven, 1);
    log.wait(2 * MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(14 * MINUTE);
  });

  it("ends for the receiving order when a plate is handed on to it", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    const nine = log.add({
      type: "orderTaken",
      pager: 9,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.wait(4 * MINUTE);
    buzz(log, seven, 1);
    log.wait(6 * MINUTE);
    log.add({
      type: "plateHandedOn",
      fromOrderId: seven.id,
      toOrderId: nine.id,
      productId: "flammkuchen",
    });
    log.wait(MINUTE);
    log.add({
      type: "platesHandedOver",
      orderId: nine.id,
      plates: [{ productId: "flammkuchen", count: 1 }],
    });
    log.add({ type: "orderAbandoned", orderId: seven.id, pagerBack: true });
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(10 * MINUTE);
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

  it("has no average for a product with no plate picked up or abandoned", () => {
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

describe("the waiting time in the order popup", () => {
  it("runs from intake to now on a line still waiting, through a partial handover", () => {
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
    expect(
      orderView(fold(log.events), seven.id, log.now)?.lines[0]?.waitingTimeMs,
    ).toBe(12 * MINUTE);
  });

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
