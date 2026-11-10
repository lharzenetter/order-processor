import { describe, expect, it } from "vitest";
import { describeEvent, fold, undoTarget } from "./index";
import type { EventBody } from "./index";
import { testLog } from "./test-log";

describe("Rückgängig", () => {
  // 05-exceptions: one undo stack, newest first, no time limit
  it("takes actions back by appending actionUndone, never by deleting them from the log", () => {
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
    const undoBuzz = log.add({ type: "actionUndone", targetId: buzz.id });
    expect(fold([order, buzz, undoBuzz]).live).toEqual([order]);

    log.wait(24 * 60 * 60_000);
    const undoOrder = log.add({ type: "actionUndone", targetId: order.id });
    const state = fold([order, buzz, undoBuzz, undoOrder]);
    expect(state.live).toEqual([]);
    expect(undoTarget(state)).toBeNull();
    // The undos only name their targets, so the fold still needs the actions they took back.
    expect(() => fold([undoBuzz, undoOrder])).toThrow();
  });

  it("refuses to undo anything but the current target", () => {
    const log = testLog();
    const first = log.add({ type: "pagerMarkedMissing", pager: 3 });
    log.add({ type: "pagerMarkedMissing", pager: 4 });
    log.add({ type: "actionUndone", targetId: first.id });
    expect(() => fold(log.events)).toThrow();
  });

  // #28: undo never turns calls back on while the transmitter is disconnected
  it("skips a switch of automatic pager calls and takes back the action before it", () => {
    const log = testLog({ device: "Links" });
    log.add({ type: "pagerMarkedMissing", pager: 3 });
    const off = log.add({ type: "pagerCallsSwitched", on: false });
    expect(undoTarget(fold(log.events))?.label).toBe(
      "Pager 3 als fehlend markiert (Links)",
    );
    log.add({ type: "actionUndone", targetId: "e1" });
    const state = fold(log.events);
    expect(state.missingPagers).toEqual([]);
    expect(state.pagerCallsOn).toBe(false);
    expect(undoTarget(state)).toBeNull();
    log.add({ type: "actionUndone", targetId: off.id });
    expect(() => fold(log.events)).toThrow();
  });

  it("refuses to undo an undo", () => {
    const log = testLog();
    const missing = log.add({ type: "pagerMarkedMissing", pager: 3 });
    const undo = log.add({ type: "actionUndone", targetId: missing.id });
    log.add({ type: "actionUndone", targetId: undo.id });
    expect(() => fold(log.events)).toThrow();
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
        [
          [{ type: "pagerCallsSwitched", on: false }],
          "Pager automatisch rufen aus",
        ],
        [
          [
            { type: "pagerCallsSwitched", on: false },
            { type: "pagerCallsSwitched", on: true },
          ],
          "Pager automatisch rufen an",
        ],
      ] satisfies [EventBody[], string][]
    ).map(([bodies, label]) => ({ bodies, label })),
  )("labels it “$label”", ({ bodies, label }) => {
    expect(labelAfter(...bodies)).toBe(label);
  });
});
