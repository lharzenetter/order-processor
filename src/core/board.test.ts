import { describe, expect, it } from "vitest";
import { boardRows, fold, nextOrderFor } from "./index";
import { testLog } from "./test-log";

function rowFor(state: ReturnType<typeof fold>, productId: string) {
  const row = boardRows(state).find((r) => r.productId === productId);
  if (row === undefined) {
    throw new Error(`no row for ${productId}`);
  }
  return row;
}

describe("the board (Übersicht)", () => {
  it("lists one row per product in display order", () => {
    const state = fold([]);
    expect(boardRows(state).map((r) => r.label)).toEqual([
      "Flammkuchen",
      "Flammkuchen Veggie",
      "Pfannkuchen",
      "Pommes",
      "Braten",
      "Schäufele",
      "Schlachtplatte",
      "Maultaschen",
      "Schupfnudeln",
      "Fleischkäs",
    ]);
    expect(rowFor(state, "braten").next).toBeNull();
  });

  it("counts the next order's x von y gerufen and each queued order's waiting plates", () => {
    const log = testLog();
    const first = log.add({
      type: "orderTaken",
      pager: 12,
      plates: [{ productId: "braten", count: 2 }],
    });
    const second = log.add({
      type: "orderTaken",
      pager: 5,
      plates: [{ productId: "braten", count: 1 }],
    });
    log.add({
      type: "platesBuzzed",
      orderId: first.id,
      productId: "braten",
      count: 1,
    });
    const state = fold(log.events);

    expect(rowFor(state, "braten").next).toMatchObject({
      orderId: first.id,
      pager: 12,
      calledCount: 1,
      plateCount: 2,
      waiting: 1,
    });
    expect(rowFor(state, "braten").queued).toEqual([
      { orderId: second.id, pager: 5, waiting: 1 },
    ]);
    expect(nextOrderFor(state, "braten", first.id)?.pager).toBe(5);
    expect(nextOrderFor(state, "maultaschen")).toBeNull();
  });

  it("marks a sold-out product's row", () => {
    const log = testLog();
    log.add({ type: "soldOutMarked", productId: "pommes" });
    const state = fold(log.events);
    expect(rowFor(state, "pommes").soldOut).toBe(true);
    expect(rowFor(state, "braten").soldOut).toBe(false);
  });
});
