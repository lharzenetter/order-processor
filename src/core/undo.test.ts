import { describe, expect, it } from "vitest";
import { describeEvent, fold } from "./index";
import type { EventBody } from "./index";
import { testLog } from "./test-log";

describe("Rückgängig", () => {
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
