import { describe, expect, it } from "vitest";
import type { OrderView } from "../core/index";
import { handoverConsequence } from "./handover-consequence";

const PAGER_5: OrderView = {
  orderId: "o1",
  pager: 5,
  takenAt: 0,
  waitingTimeMs: 0,
  open: true,
  lines: [
    {
      productId: "pommes",
      label: "Pommes",
      buzzed: 0,
      waiting: 1,
      soldOut: false,
    },
    {
      productId: "braten",
      label: "Braten",
      buzzed: 2,
      waiting: 0,
      soldOut: false,
      sinceBuzzMs: 198_000,
      rebuzzDue: true,
    },
  ],
};

describe("what the order popup says happens after the handover", () => {
  it("keeps the pager with the guest and names what is still open", () => {
    expect(handoverConsequence(PAGER_5, { braten: 2, pommes: 0 })).toBe(
      "Danach bleibt Pager 5 beim Gast – 1× Pommes noch offen.",
    );
  });

  it("counts plates left on a line the guest takes only part of", () => {
    expect(handoverConsequence(PAGER_5, { braten: 1 })).toBe(
      "Danach bleibt Pager 5 beim Gast – 1× Pommes, 1× Braten noch offen.",
    );
  });

  it("asks for the pager back when the guest takes every open plate", () => {
    expect(handoverConsequence(PAGER_5, { braten: 2, pommes: 1 })).toBe(
      "Danach Pager 5 zurücknehmen.",
    );
  });
});
