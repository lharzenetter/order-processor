import { describe, expect, it } from "vitest";
import { fold, pagerToCall } from "./index";
import type { Event } from "./index";
import { testLog } from "./test-log";

function twoOrdersWaitingForBraten() {
  const log = testLog();
  const first = log.add({
    type: "orderTaken",
    pager: 12,
    plates: [{ productId: "braten", count: 2 }],
  });
  const second = log.add({
    type: "orderTaken",
    pager: 5,
    plates: [{ productId: "braten", count: 1 }],
  });
  return { log, first, second };
}

/** The pager the newest event calls, read from the state after it. */
function calledBy(events: readonly Event[]): number | null {
  const tap = events.at(-1);
  if (tap === undefined) {
    throw new Error("no tap");
  }
  return pagerToCall(fold(events), tap);
}

// #27
describe("which pager a tap calls", () => {
  it("a buzz calls the order's pager", () => {
    const { log, first } = twoOrdersWaitingForBraten();
    log.add({
      type: "platesBuzzed",
      orderId: first.id,
      productId: "braten",
      count: 1,
    });
    expect(calledBy(log.events)).toBe(12);
  });

  it("buzzing all of a row's plates calls the order's pager once", () => {
    const { log, first } = twoOrdersWaitingForBraten();
    log.add({
      type: "platesBuzzed",
      orderId: first.id,
      productId: "braten",
      count: 2,
    });
    expect(calledBy(log.events)).toBe(12);
  });

  it("a re-buzz calls the order's pager", () => {
    const { log, first } = twoOrdersWaitingForBraten();
    log.add({
      type: "platesBuzzed",
      orderId: first.id,
      productId: "braten",
      count: 1,
    });
    log.add({ type: "rebuzzed", orderId: first.id, productId: "braten" });
    expect(calledBy(log.events)).toBe(12);
  });

  it("a hand on calls the receiving order's pager, not the giving order's", () => {
    const { log, first, second } = twoOrdersWaitingForBraten();
    log.add({
      type: "platesBuzzed",
      orderId: first.id,
      productId: "braten",
      count: 1,
    });
    log.add({
      type: "plateHandedOn",
      fromOrderId: first.id,
      toOrderId: second.id,
      productId: "braten",
    });
    expect(calledBy(log.events)).toBe(5);
  });

  it("taking an order, a handover, back to queue, cancel, abandoned order and undo call no pager", () => {
    const { log, first, second } = twoOrdersWaitingForBraten();
    expect(calledBy(log.events)).toBeNull();
    log.add({
      type: "platesBuzzed",
      orderId: first.id,
      productId: "braten",
      count: 2,
    });
    log.add({
      type: "platesHandedOver",
      orderId: first.id,
      plates: [{ productId: "braten", count: 1 }],
    });
    expect(calledBy(log.events)).toBeNull();
    log.add({
      type: "plateSentBackToQueue",
      orderId: first.id,
      productId: "braten",
    });
    expect(calledBy(log.events)).toBeNull();
    log.add({
      type: "platesCancelled",
      orderId: first.id,
      productId: "braten",
      count: 1,
    });
    expect(calledBy(log.events)).toBeNull();
    const buzz = log.add({
      type: "platesBuzzed",
      orderId: second.id,
      productId: "braten",
      count: 1,
    });
    log.add({ type: "actionUndone", targetId: buzz.id });
    expect(calledBy(log.events)).toBeNull();
    log.add({ type: "orderAbandoned", orderId: second.id, pagerBack: true });
    expect(calledBy(log.events)).toBeNull();
  });

  it("missing pagers and sold out call no pager", () => {
    const log = testLog();
    log.add({ type: "pagerMarkedMissing", pager: 3 });
    expect(calledBy(log.events)).toBeNull();
    log.add({ type: "pagerRestored", pager: 3 });
    expect(calledBy(log.events)).toBeNull();
    log.add({ type: "soldOutMarked", productId: "braten" });
    expect(calledBy(log.events)).toBeNull();
    log.add({ type: "soldOutCleared", productId: "braten" });
    expect(calledBy(log.events)).toBeNull();
  });
});

// #28
describe("automatic pager calls", () => {
  it("are on in a new event log", () => {
    expect(fold([]).pagerCallsOn).toBe(true);
  });

  it("follow the newest switch", () => {
    const log = testLog();
    log.add({ type: "pagerCallsSwitched", on: false });
    expect(fold(log.events).pagerCallsOn).toBe(false);
    log.add({ type: "pagerCallsSwitched", on: true });
    expect(fold(log.events).pagerCallsOn).toBe(true);
  });

  it("while off, a buzz, a re-buzz and a hand on call no pager", () => {
    const { log, first, second } = twoOrdersWaitingForBraten();
    log.add({ type: "pagerCallsSwitched", on: false });
    log.add({
      type: "platesBuzzed",
      orderId: first.id,
      productId: "braten",
      count: 1,
    });
    expect(calledBy(log.events)).toBeNull();
    log.add({ type: "rebuzzed", orderId: first.id, productId: "braten" });
    expect(calledBy(log.events)).toBeNull();
    log.add({
      type: "plateHandedOn",
      fromOrderId: first.id,
      toOrderId: second.id,
      productId: "braten",
    });
    expect(calledBy(log.events)).toBeNull();
  });

  it("a switch itself calls no pager", () => {
    const log = testLog();
    log.add({ type: "pagerCallsSwitched", on: true });
    expect(calledBy(log.events)).toBeNull();
  });
});
