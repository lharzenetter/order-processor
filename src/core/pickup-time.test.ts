import { describe, expect, it } from "vitest";
import { evaluationRows, fold, orderView, shiftComparison } from "./index";
import type { Event, State } from "./index";
import { testLog } from "./test-log";
import type { TestLog } from "./test-log";

const MINUTE = 60_000;

function averageFor(state: State, productId: string): number | undefined {
  return evaluationRows(state).find((r) => r.productId === productId)
    ?.averagePickupTimeMs;
}

function buzz(log: TestLog, order: Event, count: number): void {
  log.add({
    type: "platesBuzzed",
    orderId: order.id,
    productId: "flammkuchen",
    count,
  });
}

function handOver(log: TestLog, order: Event, count: number): void {
  log.add({
    type: "platesHandedOver",
    orderId: order.id,
    plates: [{ productId: "flammkuchen", count }],
  });
}

function takeOrder(log: TestLog, pager: number, count: number): Event {
  return log.add({
    type: "orderTaken",
    pager,
    plates: [{ productId: "flammkuchen", count }],
  });
}

describe("the pickup time in the Auswertung", () => {
  it("averages every plate picked up after a buzz, from its buzz to its handover", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 2);
    log.wait(5 * MINUTE);
    buzz(log, seven, 1);
    log.wait(3 * MINUTE);
    buzz(log, seven, 1);
    log.wait(MINUTE);
    handOver(log, seven, 2);
    // (4 + 1) / 2 minutes
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(2.5 * MINUTE);
  });

  it("is not restarted by a re-buzz", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 1);
    log.wait(10 * MINUTE);
    buzz(log, seven, 1);
    log.wait(5 * MINUTE);
    log.add({ type: "rebuzzed", orderId: seven.id, productId: "flammkuchen" });
    log.wait(2 * MINUTE);
    handOver(log, seven, 1);
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(7 * MINUTE);
  });

  it("leaves out a plate handed over without a buzz", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 2);
    log.wait(5 * MINUTE);
    buzz(log, seven, 1);
    log.wait(3 * MINUTE);
    handOver(log, seven, 2);
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(3 * MINUTE);
  });

  it("leaves out abandoned plates", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 1);
    buzz(log, seven, 1);
    log.wait(30 * MINUTE);
    log.add({ type: "orderAbandoned", orderId: seven.id, pagerBack: true });
    expect(averageFor(fold(log.events), "flammkuchen")).toBeUndefined();
  });

  it("runs from the replacement's buzz for a plate sent back to queue", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 1);
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
    handOver(log, seven, 1);
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(2 * MINUTE);
  });

  it("runs from the hand-on for the receiving order", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 1);
    const nine = takeOrder(log, 9, 1);
    buzz(log, seven, 1);
    log.wait(6 * MINUTE);
    log.add({
      type: "plateHandedOn",
      fromOrderId: seven.id,
      toOrderId: nine.id,
      productId: "flammkuchen",
    });
    log.wait(MINUTE);
    handOver(log, nine, 1);
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(MINUTE);
  });

  it("never counts a pickup time below zero when another iPad's clock is behind", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 1);
    buzz(log, seven, 1);
    log.wait(-MINUTE);
    handOver(log, seven, 1);
    expect(averageFor(fold(log.events), "flammkuchen")).toBe(0);
  });

  it("counts in the shift of the handover, as does the waiting time", () => {
    const log = testLog();
    log.wait(Date.parse("2026-10-24T14:50:00+02:00") - log.now);
    const seven = takeOrder(log, 7, 1);
    log.wait(5 * MINUTE);
    buzz(log, seven, 1);
    log.wait(15 * MINUTE);
    handOver(log, seven, 1);
    const comparison = shiftComparison(fold(log.events), "shift");
    const column = comparison.columns.findIndex((c) => c.id === "sa-b");
    const row = comparison.rows.find((r) => r.productId === "flammkuchen");
    expect(row?.cells[column]).toEqual({
      handedOver: 1,
      averageWaitingTimeMs: 5 * MINUTE,
      averagePickupTimeMs: 15 * MINUTE,
    });
  });
});

describe("the pickup time in the order popup", () => {
  it("runs from the line's first buzz to now, through a re-buzz", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 2);
    log.wait(5 * MINUTE);
    buzz(log, seven, 1);
    log.wait(2 * MINUTE);
    buzz(log, seven, 1);
    log.wait(3 * MINUTE);
    log.add({ type: "rebuzzed", orderId: seven.id, productId: "flammkuchen" });
    log.wait(MINUTE);
    expect(
      orderView(fold(log.events), seven.id, log.now)?.lines[0]?.pickupTimeMs,
    ).toBe(6 * MINUTE);
  });

  it("is absent on a line with nothing buzzed", () => {
    const log = testLog();
    const seven = takeOrder(log, 7, 1);
    expect(
      orderView(fold(log.events), seven.id, log.now)?.lines[0]?.pickupTimeMs,
    ).toBeUndefined();
  });
});
