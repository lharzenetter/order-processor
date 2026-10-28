import { describe, expect, it } from "vitest";
import { fold, openOrdersList } from "./index";
import { testLog } from "./test-log";

describe("the Offene Bestellungen list", () => {
  // 12-operating-features-in-the-app: the paper fallback
  it("names each entry's order and lists its lines in menu order, with plates owed and buzzed", () => {
    const log = testLog();
    const seven = log.add({
      type: "orderTaken",
      pager: 7,
      plates: [
        { productId: "braten", count: 2 },
        { productId: "pommes", count: 2 },
      ],
    });
    log.add({
      type: "platesBuzzed",
      orderId: seven.id,
      productId: "braten",
      count: 1,
    });
    log.add({
      type: "platesHandedOver",
      orderId: seven.id,
      plates: [{ productId: "pommes", count: 1 }],
    });

    expect(openOrdersList(fold(log.events))).toEqual([
      {
        orderId: seven.id,
        pager: 7,
        lines: [
          { productId: "pommes", label: "Pommes", owed: 1, buzzed: 0 },
          { productId: "braten", label: "Braten", owed: 2, buzzed: 1 },
        ],
      },
    ]);
  });
});
