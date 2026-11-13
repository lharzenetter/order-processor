import { describe, expect, it } from "vitest";
import { groupCallQuestion, groupCallToast } from "./group-call";

describe("the confirmation before a group call", () => {
  // #33
  it("names how many orders are still open", () => {
    expect(groupCallQuestion(3)).toBe(
      "3 Bestellungen noch offen. Trotzdem alle Pager rufen?",
    );
    expect(groupCallQuestion(1)).toBe(
      "1 Bestellung noch offen. Trotzdem alle Pager rufen?",
    );
  });

  it("is not asked with no open order", () => {
    expect(groupCallQuestion(0)).toBeNull();
  });
});

describe("the toast after a group call", () => {
  // #33
  it("confirms a group call briefly", () => {
    expect(groupCallToast("ok")).toEqual({
      text: "Alle Pager gerufen",
      stays: false,
      resend: false,
    });
  });

  it("keeps a failed group call on screen with Erneut senden", () => {
    expect(groupCallToast("failed")).toEqual({
      text: "Alle Pager rufen fehlgeschlagen",
      stays: true,
      resend: true,
    });
  });

  it("tells staff the transmitter isn't connected", () => {
    expect(groupCallToast("notConnected")).toEqual({
      text: "Sender nicht verbunden",
      stays: true,
      resend: false,
    });
  });
});
