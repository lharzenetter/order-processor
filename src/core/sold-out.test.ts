import { describe, expect, it } from "vitest";
import { evaluationRows, fold } from "./index";
import { testLog } from "./test-log";

describe("sold out (Ausverkauft markieren)", () => {
  it("refuses to mark a product twice or clear one that is not sold out", () => {
    const twice = testLog();
    twice.add({ type: "soldOutMarked", productId: "braten" });
    twice.add({ type: "soldOutMarked", productId: "braten" });
    expect(() => fold(twice.events)).toThrow();
    const clear = testLog();
    clear.add({ type: "soldOutCleared", productId: "braten" });
    expect(() => fold(clear.events)).toThrow();
  });
});

describe("the Auswertung", () => {
  // 11-after-event-numbers
  it("counts per product the plates made and handed over, and when it first sold out", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "braten", count: 3 }],
    });
    const nine = log.add({
      type: "orderTaken",
      pager: 9,
      plates: [{ productId: "braten", count: 2 }],
    });
    log.add({
      type: "platesBuzzed",
      orderId: seven.id,
      productId: "braten",
      count: 3,
    });
    log.add({
      type: "plateSentBackToQueue",
      orderId: seven.id,
      productId: "braten",
    });
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "braten", count: 2 }],
    });
    log.add({
      type: "platesBuzzed",
      orderId: nine.id,
      productId: "braten",
      count: 1,
    });
    log.add({ type: "orderAbandoned", orderId: nine.id, pagerBack: true });
    log.wait(60_000);
    const firstSoldOut = log.add({
      type: "soldOutMarked",
      productId: "braten",
    });
    log.add({ type: "soldOutCleared", productId: "braten" });
    log.wait(60_000);
    log.add({ type: "soldOutMarked", productId: "braten" });
    log.add({ type: "soldOutMarked", productId: "pommes" });
    log.add({ type: "soldOutCleared", productId: "pommes" });

    const rows = evaluationRows(fold(log.events));
    expect(rows.map((r) => r.productId)).toHaveLength(10);
    // made = picked up 2 + abandoned 1 + back to queue 1
    expect(rows.find((r) => r.productId === "braten")).toEqual({
      productId: "braten",
      label: "Braten",
      made: 4,
      handedOver: 2,
      averageWaitingTimeMs: 0,
      averagePickupTimeMs: 0,
      soldOutFirstAt: firstSoldOut.at,
      soldOutCleared: false,
    });
    expect(rows.find((r) => r.productId === "pommes")).toMatchObject({
      made: 0,
      soldOutCleared: true,
    });
    expect(rows.find((r) => r.productId === "maultaschen")).toEqual({
      productId: "maultaschen",
      label: "Maultaschen",
      made: 0,
      handedOver: 0,
      soldOutCleared: false,
    });
  });

  it("forgets a sold-out time whose mark was undone", () => {
    const log = testLog();
    const mark = log.add({ type: "soldOutMarked", productId: "braten" });
    log.add({ type: "actionUndone", targetId: mark.id });
    expect(
      evaluationRows(fold(log.events)).find((r) => r.productId === "braten"),
    ).not.toHaveProperty("soldOutFirstAt");
  });
});
