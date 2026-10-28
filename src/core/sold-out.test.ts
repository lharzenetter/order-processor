import { describe, expect, it } from "vitest";
import { fold, soldOutWaiting } from "./index";
import { testLog } from "./test-log";

describe("sold out (Ausverkauft markieren)", () => {
  // 05-exceptions: open orders still waiting for a sold-out product are listed
  it("shows the sold-out banners in menu order, whatever order they were marked in", () => {
    const log = testLog();
    log.add({ type: "soldOutMarked", productId: "braten" });
    log.add({ type: "soldOutMarked", productId: "flammkuchen" });
    expect(
      soldOutWaiting(fold(log.events)).map((banner) => banner.productId),
    ).toEqual(["flammkuchen", "braten"]);
  });

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
