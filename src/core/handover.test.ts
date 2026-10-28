import { describe, expect, it } from "vitest";
import {
  boardRows,
  buzzedLines,
  fold,
  headerCounts,
  openOrderByPager,
  orderView,
  pagerOverview,
} from "./index";
import { testLog } from "./test-log";

function orderOn7() {
  const log = testLog();
  const order = log.add({
    type: "orderTaken",
    pager: 7,
    plates: [
      { productId: "braten", count: 2 },
      { productId: "pommes", count: 1 },
    ],
  });
  return { log, order };
}

describe("the order popup", () => {
  it("finds the open order on a pager", () => {
    const { log, order } = orderOn7();
    const state = fold(log.events);
    expect(openOrderByPager(state, 7)?.id).toBe(order.id);
    expect(openOrderByPager(state, 8)).toBeNull();
  });

  it("lists every open line with its buzzed and waiting plates", () => {
    const { log, order } = orderOn7();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    log.wait(65_000);
    expect(orderView(fold(log.events), order.id, log.now)).toEqual({
      orderId: order.id,
      pager: 7,
      takenAt: order.at,
      open: true,
      lines: [
        {
          productId: "pommes",
          label: "Pommes",
          buzzed: 0,
          waiting: 1,
          soldOut: false,
          waitingTimeMs: 65_000,
        },
        {
          productId: "braten",
          label: "Braten",
          buzzed: 1,
          waiting: 1,
          soldOut: false,
          waitingTimeMs: 65_000,
          sinceBuzzMs: 65_000,
          rebuzzDue: false,
          pickupTimeMs: 65_000,
        },
      ],
    });
  });
});

describe("the handover (Ausgabe)", () => {
  it("counts a handed-over plate as buzzed on the board row", () => {
    const { log, order } = orderOn7();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    log.add({
      type: "platesHandedOver",
      orderId: order.id,
      plates: [{ productId: "braten", count: 1 }],
    });
    expect(
      boardRows(fold(log.events)).find((r) => r.productId === "braten")?.next,
    ).toMatchObject({ pager: 7, calledCount: 1, plateCount: 2 });
  });

  it("records the closing handover on the order and in the header", () => {
    const { log, order } = orderOn7();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 2,
    });
    log.wait(1_000);
    const handover = log.add({
      type: "platesHandedOver",
      orderId: order.id,
      plates: [
        { productId: "braten", count: 2 },
        { productId: "pommes", count: 1 },
      ],
    });
    const state = fold(log.events);
    expect(orderView(state, order.id, log.now)).toMatchObject({
      open: false,
      closedBy: "handover",
      lines: [],
    });
    expect(state.orders[0]?.closedAt).toBe(handover.at);
    expect(headerCounts(state)).toEqual({ openOrders: 0, freePagers: 30 });
  });

  it("refuses to hand over more plates than are open", () => {
    const { log, order } = orderOn7();
    log.add({
      type: "platesHandedOver",
      orderId: order.id,
      plates: [{ productId: "pommes", count: 2 }],
    });
    expect(() => fold(log.events)).toThrow();
  });

  it("refuses to act on a closed order", () => {
    const { log, order } = orderOn7();
    log.add({
      type: "platesHandedOver",
      orderId: order.id,
      plates: [
        { productId: "braten", count: 2 },
        { productId: "pommes", count: 1 },
      ],
    });
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    expect(() => fold(log.events)).toThrow();
  });
});

describe("cancelling plates (Stornieren)", () => {
  it("cancels waiting plates and keeps the order open while plates remain", () => {
    const { log, order } = orderOn7();
    log.add({
      type: "platesCancelled",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    const state = fold(log.events);
    expect(
      boardRows(state).find((r) => r.productId === "braten")?.next,
    ).toMatchObject({ pager: 7, waiting: 1, plateCount: 1 });
    expect(orderView(state, order.id, log.now)?.open).toBe(true);
  });

  // 05-exceptions: buzzed plates are only handed on or sent back, never cancelled
  it("refuses to cancel buzzed plates", () => {
    const { log, order } = orderOn7();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "pommes",
      count: 1,
    });
    log.add({
      type: "platesCancelled",
      orderId: order.id,
      productId: "pommes",
      count: 1,
    });
    expect(() => fold(log.events)).toThrow();
  });

  it("closes an order left with nothing open and frees its pager", () => {
    const { log, order } = orderOn7();
    log.add({
      type: "platesCancelled",
      orderId: order.id,
      productId: "braten",
      count: 2,
    });
    log.add({
      type: "platesCancelled",
      orderId: order.id,
      productId: "pommes",
      count: 1,
    });
    const state = fold(log.events);
    expect(orderView(state, order.id, log.now)).toMatchObject({
      open: false,
      closedBy: "cancel",
    });
    expect(pagerOverview(state).free).toContain(7);
  });
});

describe("closing an abandoned order (Verwaiste Bestellung schließen)", () => {
  it("closes the order and frees a returned pager", () => {
    const { log, order } = orderOn7();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    log.add({ type: "orderAbandoned", orderId: order.id, pagerBack: true });
    const state = fold(log.events);
    expect(orderView(state, order.id, log.now)).toMatchObject({
      open: false,
      closedBy: "abandoned",
    });
    expect(buzzedLines(state, log.now)).toEqual([]);
    expect(boardRows(state).every((r) => r.next === null)).toBe(true);
    expect(pagerOverview(state).free).toContain(7);
  });

  it("marks a pager that did not come back as missing", () => {
    const { log, order } = orderOn7();
    log.add({ type: "orderAbandoned", orderId: order.id, pagerBack: false });
    const overview = pagerOverview(fold(log.events));
    expect(overview.missing).toEqual([7]);
    expect(overview.free).not.toContain(7);
  });

  it("refuses to abandon a closed order", () => {
    const { log, order } = orderOn7();
    log.add({ type: "orderAbandoned", orderId: order.id, pagerBack: true });
    log.add({ type: "orderAbandoned", orderId: order.id, pagerBack: true });
    expect(() => fold(log.events)).toThrow();
  });
});
