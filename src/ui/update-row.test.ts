import { describe, expect, it } from "vitest";
import { formatClock } from "./format";
import { updateRow } from "./update-row";

describe("the Version row in the Verwaltung", () => {
  it("offers an update check while nothing is known", () => {
    expect(updateRow({ phase: "idle" }, false, null)).toEqual({
      status: "Aktuell",
      action: "check",
      label: "Nach Updates suchen",
      disabled: false,
    });
  });

  it("disables the check while it runs", () => {
    expect(updateRow({ phase: "checking" }, false, null)).toEqual({
      status: "Suche nach Updates…",
      action: "check",
      label: "Nach Updates suchen",
      disabled: true,
    });
  });

  it("names the time of a check that found no update", () => {
    const checkedAt = Date.UTC(2026, 9, 20, 12, 32);
    expect(updateRow({ phase: "current", checkedAt }, false, null)).toEqual({
      status: `Aktuell · geprüft ${formatClock(checkedAt)}`,
      action: "check",
      label: "Nach Updates suchen",
      disabled: false,
    });
  });

  it("says when a check could not reach the server", () => {
    expect(updateRow({ phase: "failed" }, false, null)).toEqual({
      status: "Keine Verbindung · nicht geprüft",
      action: "check",
      label: "Nach Updates suchen",
      disabled: false,
    });
  });

  it("offers Aktualisieren with the waiting version", () => {
    expect(updateRow({ phase: "idle" }, true, "0.4.0")).toEqual({
      status: "Neue Version 0.4.0 bereit",
      action: "install",
      label: "Aktualisieren",
      disabled: false,
    });
  });

  it("offers Aktualisieren without a number when the waiting version is unknown", () => {
    expect(updateRow({ phase: "failed" }, true, null)).toEqual({
      status: "Neue Version bereit",
      action: "install",
      label: "Aktualisieren",
      disabled: false,
    });
  });
});
