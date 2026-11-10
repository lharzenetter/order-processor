import { describe, expect, it } from "vitest";
import { pagerCallToast } from "./pager-call-toast";

describe("the toast after a pager call", () => {
  // #26
  it("confirms a call briefly", () => {
    expect(pagerCallToast(21, "ok")).toEqual({
      text: "Pager 21 gerufen",
      stays: false,
      resend: false,
    });
  });

  it("keeps a failed call on screen with Erneut senden", () => {
    expect(pagerCallToast(21, "failed")).toEqual({
      text: "Pager 21 nicht gerufen",
      stays: true,
      resend: true,
    });
  });

  it("tells staff to call by hand when the transmitter isn't connected", () => {
    expect(pagerCallToast(7, "notConnected")).toEqual({
      text: "Sender nicht verbunden – Pager 7 von Hand rufen",
      stays: true,
      resend: false,
    });
  });
});
