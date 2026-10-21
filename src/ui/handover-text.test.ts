import { describe, expect, it } from "vitest";
import { handedOverText, handOverLabel } from "./handover-text";

describe("the order popup's handover button", () => {
  it("names the plates the guest takes, in menu order", () => {
    expect(
      handOverLabel([
        { productId: "braten", count: 1 },
        { productId: "pommes", count: 2 },
      ]),
    ).toBe("2× Pommes, 1× Braten ausgeben");
  });

  it("says just Ausgeben while nothing is picked", () => {
    expect(handOverLabel([])).toBe("Ausgeben");
  });
});

describe("the receipt after a handover", () => {
  it("names the plates that just went out", () => {
    expect(
      handedOverText([
        { productId: "braten", count: 1 },
        { productId: "pommes", count: 2 },
      ]),
    ).toBe("Ausgegeben: 2× Pommes, 1× Braten.");
  });
});
