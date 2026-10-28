import { describe, expect, it } from "vitest";
import { fold, shiftComparison } from "./index";
import { testLog } from "./test-log";
import type { TestLog } from "./test-log";

function waitUntil(log: TestLog, iso: string): void {
  log.wait(Date.parse(iso) - log.now);
}

/** Takes an order for one plate at `orderIso` and hands it over at `handoverIso`. */
function serve(
  log: TestLog,
  productId: string,
  orderIso: string,
  handoverIso: string,
): void {
  waitUntil(log, orderIso);
  const order = log.add({
    type: "orderTaken",
    pager: 7,
    plates: [{ productId, count: 1 }],
  });
  waitUntil(log, handoverIso);
  log.add({
    type: "platesHandedOver",
    orderId: order.id,
    plates: [{ productId, count: 1 }],
  });
}

describe("the comparison of the shifts", () => {
  it("has one column per shift, in calendar order", () => {
    const log = testLog();
    serve(
      log,
      "braten",
      "2026-10-24T11:00:00+02:00",
      "2026-10-24T11:05:00+02:00",
    );
    expect(
      shiftComparison(fold(log.events), "shift").columns.map((c) => c.label),
    ).toEqual([
      "Sa A",
      "Sa B",
      "Sa C",
      "So C",
      "So A",
      "So B",
      "Mo C",
      "Mo B",
      "Mo A",
    ]);
  });
});

describe("the comparison of the crews", () => {
  it("has one column per crew with the shifts it sums", () => {
    const log = testLog();
    serve(
      log,
      "braten",
      "2026-10-24T11:00:00+02:00",
      "2026-10-24T11:05:00+02:00",
    );
    expect(
      shiftComparison(fold(log.events), "crew").columns.map((c) => ({
        label: c.label,
        shifts: c.shifts.map((s) => s.label),
      })),
    ).toEqual([
      { label: "Gruppe A", shifts: ["Sa A", "So A", "Mo A"] },
      { label: "Gruppe B", shifts: ["Sa B", "So B", "Mo B"] },
      { label: "Gruppe C", shifts: ["Sa C", "So C", "Mo C"] },
    ]);
  });

  it("has no columns before the first event", () => {
    const comparison = shiftComparison(fold([]), "crew");
    expect(comparison.columns).toEqual([]);
    expect(comparison.totals).toEqual([]);
  });
});
