import { describe, expect, it } from "vitest";
import { formatSince } from "./format";
import { pressKey } from "./Keypad";

describe("the time since a buzz", () => {
  it.each([
    [0, "0:00"],
    [59_999, "0:59"],
    [65_000, "1:05"],
    [3_600_000, "60:00"],
  ])("shows %i ms as %s", (ms, text) => {
    expect(formatSince(ms)).toBe(text);
  });
});

describe("the pager keypad", () => {
  it("types at most two digits, keeping the newest", () => {
    expect(["1", "7", "3"].reduce(pressKey, "")).toBe("73");
  });

  it("deletes the last digit and clears", () => {
    expect(pressKey("17", "⌫")).toBe("1");
    expect(pressKey("17", "C")).toBe("");
  });
});
