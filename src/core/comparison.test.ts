import { describe, expect, it } from "vitest";
import { fold, shiftComparison } from "./index";
import type { Comparison, ComparisonCell } from "./index";
import { testLog } from "./test-log";
import type { TestLog } from "./test-log";

const MINUTE = 60_000;

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

function cell(
  comparison: Comparison,
  productId: string,
  columnId: string,
): ComparisonCell | undefined {
  const column = comparison.columns.findIndex((c) => c.id === columnId);
  return comparison.rows.find((r) => r.productId === productId)?.cells[column];
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

  it("counts each plate in the shift of its handover, with its waiting time", () => {
    const log = testLog();
    serve(
      log,
      "braten",
      "2026-10-24T14:55:00+02:00",
      "2026-10-24T15:10:00+02:00",
    );
    const comparison = shiftComparison(fold(log.events), "shift");
    expect(cell(comparison, "braten", "sa-b")).toEqual({
      handedOver: 1,
      averageWaitingTimeMs: 15 * MINUTE,
    });
    expect(cell(comparison, "braten", "sa-a")).toEqual({ handedOver: 0 });
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

  it("sums a crew's shifts over all Kirbe days, averaging the waiting time over every plate", () => {
    const log = testLog();
    serve(
      log,
      "braten",
      "2026-10-24T11:00:00+02:00",
      "2026-10-24T11:04:00+02:00",
    );
    serve(
      log,
      "braten",
      "2026-10-25T16:00:00+01:00",
      "2026-10-25T16:10:00+01:00",
    );
    const comparison = shiftComparison(fold(log.events), "crew");
    expect(cell(comparison, "braten", "a")).toEqual({
      handedOver: 2,
      averageWaitingTimeMs: 7 * MINUTE,
    });
    expect(cell(comparison, "braten", "b")).toEqual({ handedOver: 0 });
  });

  it("totals every product per column", () => {
    const log = testLog();
    serve(
      log,
      "braten",
      "2026-10-24T11:00:00+02:00",
      "2026-10-24T11:04:00+02:00",
    );
    serve(
      log,
      "pommes",
      "2026-10-24T12:00:00+02:00",
      "2026-10-24T12:02:00+02:00",
    );
    const comparison = shiftComparison(fold(log.events), "crew");
    expect(comparison.totals[0]).toEqual({
      handedOver: 2,
      averageWaitingTimeMs: 3 * MINUTE,
    });
    expect(comparison.totals[1]).toEqual({ handedOver: 0 });
  });

  it("has no columns before the first event", () => {
    const comparison = shiftComparison(fold([]), "crew");
    expect(comparison.columns).toEqual([]);
    expect(comparison.totals).toEqual([]);
  });
});
