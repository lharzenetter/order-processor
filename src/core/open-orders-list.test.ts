import { describe, expect, it } from "vitest";
import { fold, openOrdersList } from "./index";
import { testLog } from "./test-log";

describe("the Offene Bestellungen list", () => {
  // 12-operating-features-in-the-app: the paper fallback
  it("lists open orders by pager with the plates still owed and how many are buzzed", () => {
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
      type: "orderTaken",
      pager: 3,
      plates: [{ productId: "maultaschen", count: 1 }],
    });
    const twelve = log.add({
      type: "orderTaken",
      pager: 12,
      plates: [{ productId: "pommes", count: 1 }],
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
    log.add({
      type: "platesHandedOver",
      orderId: twelve.id,
      plates: [{ productId: "pommes", count: 1 }],
    });

    expect(openOrdersList(fold(log.events))).toEqual([
      {
        orderId: "e2",
        pager: 3,
        lines: [
          {
            productId: "maultaschen",
            label: "Maultaschen",
            owed: 1,
            buzzed: 0,
          },
        ],
      },
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
