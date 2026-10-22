import { describe, expect, it } from "vitest";
import { fold, waitingPlates } from "./index";
import { testLog } from "./test-log";

describe("waiting plates on the Küchenanzeige", () => {
  it("sums the plates open orders still wait for, per product in the product selection", () => {
    const log = testLog();
    log.add({
      type: "orderTaken",
      pager: 1,
      plates: [
        { productId: "flammkuchen", count: 2 },
        { productId: "braten", count: 1 },
      ],
    });
    log.add({
      type: "orderTaken",
      pager: 2,
      plates: [
        { productId: "flammkuchen", count: 3 },
        { productId: "flammkuchen-veggie", count: 1 },
      ],
    });

    expect(
      waitingPlates(fold(log.events), ["flammkuchen", "flammkuchen-veggie"]),
    ).toEqual([
      { productId: "flammkuchen", label: "Flammkuchen", waiting: 5 },
      {
        productId: "flammkuchen-veggie",
        label: "Flammkuchen Veggie",
        waiting: 1,
      },
    ]);
  });

  it("drops buzzed and cancelled plates and counts a plate sent back to queue again", () => {
    const log = testLog();
    const order = log.add({
      type: "orderTaken",
      pager: 1,
      plates: [{ productId: "flammkuchen", count: 4 }],
    });
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "flammkuchen",
      count: 2,
    });
    log.add({
      type: "platesCancelled",
      orderId: order.id,
      productId: "flammkuchen",
      count: 1,
    });
    expect(waitingPlates(fold(log.events), ["flammkuchen"])[0]?.waiting).toBe(
      1,
    );

    log.add({
      type: "plateSentBackToQueue",
      orderId: order.id,
      productId: "flammkuchen",
    });
    expect(waitingPlates(fold(log.events), ["flammkuchen"])[0]?.waiting).toBe(
      2,
    );
  });

  it("shows a product nobody waits for as zero", () => {
    expect(waitingPlates(fold([]), ["pommes"])).toEqual([
      { productId: "pommes", label: "Pommes", waiting: 0 },
    ]);
  });

  it("shows the selection in menu display order and skips products no longer on the menu", () => {
    expect(
      waitingPlates(fold([]), ["braten", "gestrichen", "flammkuchen"]).map(
        (p) => p.productId,
      ),
    ).toEqual(["flammkuchen", "braten"]);
  });
});
