import { describe, expect, it } from "vitest";
import { kirbeAt, movingTo, passing, START_AT } from "./kirbe-calendar";

describe("the Kirbe calendar of the scenarios", () => {
  it("counts the hour the clocks go back on the Sonntag night", () => {
    expect(kirbeAt("Sonntag 03:30") - kirbeAt("Sonntag 01:30")).toBe(
      3 * 60 * 60_000,
    );
  });

  it("refuses the hour the clocks go back as ambiguous", () => {
    expect(() => kirbeAt("Sonntag 02:30")).toThrow(/happens twice/);
  });

  it("refuses a day that is not a Kirbe day", () => {
    expect(() => kirbeAt("Freitag 11:30")).toThrow(/no time on the Kirbe/);
  });

  it("refuses a time of day that does not exist", () => {
    expect(() => kirbeAt("Samstag 24:00")).toThrow(/no time on the Kirbe/);
  });

  it("refuses to move time backwards", () => {
    expect(() => movingTo(kirbeAt("Samstag 12:00"), "Samstag 11:30")).toThrow(
      /time only moves forward/,
    );
  });

  it("refuses to let no time or negative time pass", () => {
    expect(() => passing(START_AT, {})).toThrow(/time only moves forward/);
    expect(() => passing(START_AT, { seconds: -1 })).toThrow(
      /time only moves forward/,
    );
  });
});
