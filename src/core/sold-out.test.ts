import { describe, expect, it } from "vitest";
import { fold } from "./index";
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
