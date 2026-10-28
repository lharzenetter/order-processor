import { describe, expect, it } from "vitest";
import { fold } from "./index";
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

describe("Weitergeben", () => {
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
  it("refuses when nothing is buzzed", () => {
    const { log, receiver } = bratenOn12And5();
    log.add({
      type: "plateSentBackToQueue",
      orderId: receiver.id,
      productId: "braten",
    });
    expect(() => fold(log.events)).toThrow();
  });
});
