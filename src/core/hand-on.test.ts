import { describe, expect, it } from "vitest";
import { boardRows, buzzedLines, fold, handOnTarget } from "./index";
import { testLog } from "./test-log";

function bratenOn12And5() {
  const log = testLog();
  const giver = log.add({
    type: "orderTaken",
    pager: 12,
    plates: [{ productId: "braten", count: 1 }],
  });
  const receiver = log.add({
    type: "orderTaken",
    pager: 5,
    plates: [{ productId: "braten", count: 1 }],
  });
  log.add({
    type: "platesBuzzed",
    orderId: giver.id,
    productId: "braten",
    count: 1,
  });
  return { log, giver, receiver };
}

function bratenRow(state: ReturnType<typeof fold>) {
  return boardRows(state).find((r) => r.productId === "braten");
}

describe("Weitergeben", () => {
  it("offers the next order waiting for the dish, other than the giver", () => {
    const { log, giver } = bratenOn12And5();
    expect(handOnTarget(fold(log.events), giver.id, "braten")?.pager).toBe(5);
  });

  it("offers nobody when no other order waits for the dish", () => {
    const log = testLog();
    const giver = log.add({
      type: "orderTaken",
      pager: 12,
      plates: [{ productId: "braten", count: 2 }],
    });
    log.add({
      type: "platesBuzzed",
      orderId: giver.id,
      productId: "braten",
      count: 1,
    });
    // The giver itself still waits for its second Braten, but cannot receive its own plate.
    expect(handOnTarget(fold(log.events), giver.id, "braten")).toBeNull();
  });

  // 04-allocation-and-handover-rules: a no-show's plate moves on, the giver keeps its FIFO place
  it("moves one buzzed plate to the receiver, and the giver waits again in its FIFO place", () => {
    const { log, giver, receiver } = bratenOn12And5();
    log.wait(200_000);
    log.add({
      type: "plateHandedOn",
      fromOrderId: giver.id,
      toOrderId: receiver.id,
      productId: "braten",
    });
    log.wait(10_000);
    const state = fold(log.events);

    expect(bratenRow(state)?.next).toMatchObject({ pager: 12, waiting: 1 });
    // The hand-on counts as the receiver's buzz: its clock starts.
    expect(buzzedLines(state, log.now)).toEqual([
      expect.objectContaining({ pager: 5, buzzed: 1, sinceBuzzMs: 10_000 }),
    ]);
  });

  it("refuses a hand-on from a line with nothing buzzed", () => {
    const { log, giver, receiver } = bratenOn12And5();
    log.add({
      type: "plateHandedOn",
      fromOrderId: receiver.id,
      toOrderId: giver.id,
      productId: "braten",
    });
    expect(() => fold(log.events)).toThrow();
  });

  it("refuses a hand-on to the giver itself or to an order not waiting for the dish", () => {
    const { log, giver } = bratenOn12And5();
    const pommes = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "pommes", count: 1 }],
    });
    for (const toOrderId of [giver.id, pommes.id]) {
      const events = [
        ...log.events,
        {
          type: "plateHandedOn" as const,
          fromOrderId: giver.id,
          toOrderId,
          productId: "braten",
          id: "x",
          seq: 99,
          at: log.now,
        },
      ];
      expect(() => fold(events)).toThrow();
    }
  });
});

describe("Zurück in Warteschlange", () => {
  // 05-exceptions: a buzzed plate that can't be handed out waits again with its FIFO place kept
  it("takes one buzzed plate off the order, which waits for the dish again in its FIFO place", () => {
    const { log, giver } = bratenOn12And5();
    log.add({
      type: "plateSentBackToQueue",
      orderId: giver.id,
      productId: "braten",
    });
    const state = fold(log.events);
    expect(bratenRow(state)?.next).toMatchObject({
      pager: 12,
      waiting: 1,
      calledCount: 0,
    });
    expect(buzzedLines(state, log.now)).toEqual([]);
  });

  it("refuses when nothing is buzzed", () => {
    const { log, receiver } = bratenOn12And5();
    log.add({
      type: "plateSentBackToQueue",
      orderId: receiver.id,
      productId: "braten",
    });
    expect(() => fold(log.events)).toThrow();
  });

  it("clears the line's clock only when its last buzzed plate goes back", () => {
    const log = testLog();
    const order = log.add({
      type: "orderTaken",
      pager: 12,
      plates: [{ productId: "braten", count: 2 }],
    });
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 2,
    });
    log.wait(30_000);
    log.add({
      type: "plateSentBackToQueue",
      orderId: order.id,
      productId: "braten",
    });
    expect(buzzedLines(fold(log.events), log.now)).toEqual([
      expect.objectContaining({ buzzed: 1, sinceBuzzMs: 30_000 }),
    ]);
    log.add({
      type: "plateSentBackToQueue",
      orderId: order.id,
      productId: "braten",
    });
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    log.wait(1_000);
    expect(buzzedLines(fold(log.events), log.now)).toEqual([
      expect.objectContaining({ buzzed: 1, sinceBuzzMs: 1_000 }),
    ]);
  });
});
