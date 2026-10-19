import { describe, expect, it } from "vitest";
import {
  boardRows,
  describeEvent,
  fold,
  openOrderByPager,
  pagerOverview,
  undoTarget,
} from "./index";
import type { EventBody } from "./index";
import { testLog } from "./test-log";

describe("Rückgängig", () => {
  it("has nothing to undo on an empty log", () => {
    expect(undoTarget(fold([]))).toBeNull();
  });

  it("targets the newest action and names it", () => {
    const log = testLog();
    const order = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "braten", count: 1 }],
    });
    const buzz = log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    expect(undoTarget(fold(log.events))).toEqual({
      event: buzz,
      label: "Braten gerufen → Pager 7",
    });
  });

  // 05-exceptions: one undo stack, newest first, no time limit
  it("undoes repeatedly, newest first, without deleting anything", () => {
    const log = testLog();
    const order = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "braten", count: 2 }],
    });
    const buzz = log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 2,
    });
    log.add({ type: "actionUndone", targetId: buzz.id });
    const afterOne = fold(log.events);
    expect(boardRows(afterOne)[4]?.next).toMatchObject({
      pager: 7,
      waiting: 2,
    });
    expect(undoTarget(afterOne)?.event.id).toBe(order.id);

    log.wait(24 * 60 * 60_000);
    log.add({ type: "actionUndone", targetId: order.id });
    const afterTwo = fold(log.events);
    expect(openOrderByPager(afterTwo, 7)).toBeNull();
    expect(undoTarget(afterTwo)).toBeNull();
    expect(log.events).toHaveLength(4);
  });

  it("refuses to undo anything but the current target", () => {
    const log = testLog();
    const first = log.add({ type: "pagerMarkedMissing", pager: 3 });
    log.add({ type: "pagerMarkedMissing", pager: 4 });
    log.add({ type: "actionUndone", targetId: first.id });
    expect(() => fold(log.events)).toThrow();
  });

  it("refuses to undo an undo", () => {
    const log = testLog();
    const missing = log.add({ type: "pagerMarkedMissing", pager: 3 });
    const undo = log.add({ type: "actionUndone", targetId: missing.id });
    log.add({ type: "actionUndone", targetId: undo.id });
    expect(() => fold(log.events)).toThrow();
  });

  it("brings back a missing pager that an undone intake had restored", () => {
    const log = testLog();
    log.add({ type: "pagerMarkedMissing", pager: 23 });
    const order = log.add({
      type: "orderTaken",
      pager: 23,
      plates: [{ productId: "pommes", count: 1 }],
    });
    log.add({ type: "actionUndone", targetId: order.id });
    expect(pagerOverview(fold(log.events)).missing).toEqual([23]);
  });

  // 10-event-catalog-and-core-state: strict stack, so the blocked undo is dropped
  it("undoes a new order on a reused pager before the handover that freed it", () => {
    const log = testLog();
    const first = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "pommes", count: 1 }],
    });
    const handover = log.add({
      type: "platesHandedOver",
      orderId: first.id,
      plates: [{ productId: "pommes", count: 1 }],
    });
    const second = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [{ productId: "braten", count: 1 }],
    });
    expect(undoTarget(fold(log.events))?.event.id).toBe(second.id);
    log.add({ type: "actionUndone", targetId: second.id });
    expect(undoTarget(fold(log.events))?.event.id).toBe(handover.id);
    log.add({ type: "actionUndone", targetId: handover.id });
    expect(openOrderByPager(fold(log.events), 7)?.id).toBe(first.id);
  });
});

describe("describeEvent", () => {
  function labelAfter(...bodies: readonly EventBody[]): string {
    const log = testLog();
    log.add({
      type: "orderTaken",
      pager: 7,
      plates: [
        { productId: "braten", count: 2 },
        { productId: "pommes", count: 1 },
      ],
    });
    log.add({
      type: "orderTaken",
      pager: 9,
      plates: [{ productId: "braten", count: 1 }],
    });
    let last = log.events[0];
    for (const body of bodies) {
      last = log.add(body);
    }
    if (last === undefined) {
      throw new Error("no event");
    }
    return describeEvent(last, fold(log.events));
  }

  it.each(
    (
      [
        [[], "Neue Bestellung 1× Pommes, 2× Braten → Pager 7"],
        [
          [
            {
              type: "platesBuzzed",
              orderId: "e1",
              productId: "braten",
              count: 2,
            },
          ],
          "2× Braten gerufen → Pager 7",
        ],
        [
          [
            {
              type: "platesBuzzed",
              orderId: "e1",
              productId: "braten",
              count: 1,
            },
            {
              type: "plateHandedOn",
              fromOrderId: "e1",
              toOrderId: "e2",
              productId: "braten",
            },
          ],
          "Braten weitergegeben: Pager 7 → Pager 9",
        ],
        [
          [
            {
              type: "platesBuzzed",
              orderId: "e1",
              productId: "braten",
              count: 1,
            },
            {
              type: "plateSentBackToQueue",
              orderId: "e1",
              productId: "braten",
            },
          ],
          "Braten für Pager 7 zurück in Warteschlange",
        ],
        [
          [
            {
              type: "platesBuzzed",
              orderId: "e1",
              productId: "braten",
              count: 1,
            },
            { type: "rebuzzed", orderId: "e1", productId: "braten" },
          ],
          "Pager 7 nochmal gerufen (Braten)",
        ],
        [
          [
            {
              type: "platesHandedOver",
              orderId: "e1",
              plates: [
                { productId: "braten", count: 1 },
                { productId: "pommes", count: 1 },
              ],
            },
          ],
          "Ausgabe Pager 7: 1× Pommes, 1× Braten",
        ],
        [
          [
            {
              type: "platesCancelled",
              orderId: "e1",
              productId: "braten",
              count: 1,
            },
          ],
          "1× Braten storniert auf Pager 7",
        ],
        [
          [{ type: "orderAbandoned", orderId: "e1", pagerBack: true }],
          "Bestellung auf Pager 7 geschlossen",
        ],
        [
          [{ type: "orderAbandoned", orderId: "e1", pagerBack: false }],
          "Bestellung auf Pager 7 geschlossen, Pager fehlt",
        ],
        [
          [{ type: "pagerMarkedMissing", pager: 23 }],
          "Pager 23 als fehlend markiert",
        ],
        [
          [
            { type: "pagerMarkedMissing", pager: 23 },
            { type: "pagerRestored", pager: 23 },
          ],
          "Pager 23 wieder freigegeben",
        ],
        [
          [{ type: "soldOutMarked", productId: "pommes" }],
          "Pommes ausverkauft",
        ],
        [
          [
            { type: "soldOutMarked", productId: "pommes" },
            { type: "soldOutCleared", productId: "pommes" },
          ],
          "Pommes wieder verfügbar",
        ],
      ] satisfies [EventBody[], string][]
    ).map(([bodies, label]) => ({ bodies, label })),
  )("labels it “$label”", ({ bodies, label }) => {
    expect(labelAfter(...bodies)).toBe(label);
  });
});
