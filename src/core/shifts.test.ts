import { describe, expect, it } from "vitest";
import { evaluationRows, fold, kirbeShifts } from "./index";
import type { EvaluationRow, State } from "./index";
import { testLog } from "./test-log";
import type { TestLog } from "./test-log";

/** Berlin wall-clock time during the Kirbe of 24.–26.10.2026 (CEST until Sunday 03:00). */
function at(iso: string): number {
  return Date.parse(iso);
}

function waitUntil(log: TestLog, iso: string): void {
  log.wait(at(iso) - log.now);
}

function startsAt(log: TestLog, iso: string): TestLog {
  waitUntil(log, iso);
  return log;
}

function rowFor(
  state: State,
  shiftId: string,
  productId: string,
): EvaluationRow {
  const row = evaluationRows(state, shiftId).find(
    (r) => r.productId === productId,
  );
  if (row === undefined) {
    throw new Error(`No row for ${productId}`);
  }
  return row;
}

/** Takes an order for one Braten on pager 7 now and hands it over at `handoverIso`. */
function braten(log: TestLog, handoverIso: string): void {
  const order = log.add({
    type: "orderTaken",
    pager: 7,
    plates: [{ productId: "braten", count: 1 }],
  });
  waitUntil(log, handoverIso);
  log.add({
    type: "platesHandedOver",
    orderId: order.id,
    plates: [{ productId: "braten", count: 1 }],
  });
}

describe("the shifts of the Kirbe", () => {
  it("count each moment for one shift only, from the end of the shift before", () => {
    const log = startsAt(testLog(), "2026-10-24T11:00:00+02:00");
    log.add({ type: "pagerMarkedMissing", pager: 30 });
    expect(
      kirbeShifts(fold(log.events)).map((shift) => ({
        id: shift.id,
        label: shift.label,
        crew: shift.crew,
        countsFromAt: shift.countsFromAt,
        countsUntilAt: shift.countsUntilAt,
      })),
    ).toEqual([
      {
        id: "sa-a",
        label: "Sa A",
        crew: "A",
        countsFromAt: undefined,
        countsUntilAt: at("2026-10-24T15:00:00+02:00"),
      },
      {
        id: "sa-b",
        label: "Sa B",
        crew: "B",
        countsFromAt: at("2026-10-24T15:00:00+02:00"),
        countsUntilAt: at("2026-10-24T20:00:00+02:00"),
      },
      {
        id: "sa-c",
        label: "Sa C",
        crew: "C",
        countsFromAt: at("2026-10-24T20:00:00+02:00"),
        countsUntilAt: at("2026-10-25T10:00:00+01:00"),
      },
      {
        id: "so-c",
        label: "So C",
        crew: "C",
        countsFromAt: at("2026-10-25T10:00:00+01:00"),
        countsUntilAt: at("2026-10-25T15:00:00+01:00"),
      },
      {
        id: "so-a",
        label: "So A",
        crew: "A",
        countsFromAt: at("2026-10-25T15:00:00+01:00"),
        countsUntilAt: at("2026-10-25T18:30:00+01:00"),
      },
      {
        id: "so-b",
        label: "So B",
        crew: "B",
        countsFromAt: at("2026-10-25T18:30:00+01:00"),
        countsUntilAt: at("2026-10-26T10:00:00+01:00"),
      },
      {
        id: "mo-c",
        label: "Mo C",
        crew: "C",
        countsFromAt: at("2026-10-26T10:00:00+01:00"),
        countsUntilAt: at("2026-10-26T15:00:00+01:00"),
      },
      {
        id: "mo-b",
        label: "Mo B",
        crew: "B",
        countsFromAt: at("2026-10-26T15:00:00+01:00"),
        countsUntilAt: at("2026-10-26T19:30:00+01:00"),
      },
      {
        id: "mo-a",
        label: "Mo A",
        crew: "A",
        countsFromAt: at("2026-10-26T19:30:00+01:00"),
        countsUntilAt: undefined,
      },
    ]);
  });

  it("keep the planned times of the Festbetrieb plan, with an open end where it says Ende", () => {
    const log = startsAt(testLog(), "2026-10-24T11:00:00+02:00");
    log.add({ type: "pagerMarkedMissing", pager: 30 });
    const [saA, , saC] = kirbeShifts(fold(log.events));
    expect(saA?.startAt).toBe(at("2026-10-24T10:00:00+02:00"));
    expect(saA?.endAt).toBe(at("2026-10-24T15:00:00+02:00"));
    expect(saC?.startAt).toBe(at("2026-10-24T19:00:00+02:00"));
    expect(saC?.endAt).toBeUndefined();
  });

  it("belong to the Saturday nearest to the first event, so Friday tests land on the coming Kirbe", () => {
    const friday = startsAt(testLog(), "2026-10-23T18:00:00+02:00");
    friday.add({ type: "pagerMarkedMissing", pager: 30 });
    expect(kirbeShifts(fold(friday.events))[0]?.startAt).toBe(
      at("2026-10-24T10:00:00+02:00"),
    );
  });

  it("belong to the Saturday just past when the log starts on Sunday", () => {
    const sunday = startsAt(testLog(), "2026-10-25T12:00:00+01:00");
    sunday.add({ type: "pagerMarkedMissing", pager: 30 });
    expect(kirbeShifts(fold(sunday.events))[0]?.startAt).toBe(
      at("2026-10-24T10:00:00+02:00"),
    );
  });

  it("do not exist before the first event", () => {
    expect(kirbeShifts(fold([]))).toEqual([]);
  });
});

describe("the Auswertung of one shift", () => {
  it("counts everything before the Kirbe's first shift for that shift", () => {
    const log = startsAt(testLog(), "2026-10-24T09:30:00+02:00");
    braten(log, "2026-10-24T09:40:00+02:00");
    expect(rowFor(fold(log.events), "sa-a", "braten").handedOver).toBe(1);
  });
});
