import { describe, expect, it } from "vitest";
import { powerOffQuestion, powerOffToast } from "./power-off";

const WAY_BACK =
  "Alle Pager in der Ladestation ausschalten? Wieder einschalten: Ladestation aus- und einstecken, dann jeden Pager herausnehmen und wieder einsetzen.";

describe("the confirmation before a power-off", () => {
  // #32
  it("spells out the way back with no open order", () => {
    expect(powerOffQuestion(0)).toBe(WAY_BACK);
  });

  it("names how many orders are still open", () => {
    expect(powerOffQuestion(3)).toBe(`3 Bestellungen noch offen. ${WAY_BACK}`);
    expect(powerOffQuestion(1)).toBe(`1 Bestellung noch offen. ${WAY_BACK}`);
  });
});

describe("the toast after a power-off", () => {
  // #32
  it("confirms a power-off briefly", () => {
    expect(powerOffToast("ok")).toEqual({
      text: "Pager ausgeschaltet",
      stays: false,
      resend: false,
    });
  });

  it("keeps a failed power-off on screen with Erneut senden", () => {
    expect(powerOffToast("failed")).toEqual({
      text: "Ausschalten fehlgeschlagen",
      stays: true,
      resend: true,
    });
  });

  it("tells staff the transmitter isn't connected", () => {
    expect(powerOffToast("notConnected")).toEqual({
      text: "Sender nicht verbunden",
      stays: true,
      resend: false,
    });
  });
});
