import {
  evaluationRows,
  kirbeShifts,
  labelOf,
  shiftComparison,
} from "../src/core";
import type {
  ComparisonCell,
  EvaluationRow,
  ProductId,
  Shift,
  State,
} from "../src/core";
import { berlinClock, clockOf, CORE_DAY, msOf } from "./kirbe-calendar";
import type {
  AverageSeen,
  ComparisonCellSeen,
  CrewName,
  EvaluationRowSeen,
  ShiftName,
  SoldOutCellSeen,
} from "./window";

/** "Samstag · Gruppe A", as the Festbetrieb plan names a shift. */
function shiftText({ day, crew }: ShiftName): string {
  return `${day} · Gruppe ${crew}`;
}

/** A Vergleich column as staff name it: a shift, or "Gruppe A". */
function columnName(column: ShiftName | CrewName): string {
  return "day" in column ? shiftText(column) : `Gruppe ${column.crew}`;
}

/** An average as the Auswertung shows it: "m:ss", or "–". */
function averageText(averageMs: number | undefined): string {
  return averageMs === undefined ? "–" : clockOf(averageMs);
}

function wantedAverage(average: AverageSeen): string {
  return average === "none" ? "–" : clockOf(msOf(average));
}

function quoted(text: string): string {
  return text === "" ? "empty" : `"${text}"`;
}

/** One figure of a table, as staff read it, and what the scenario wants it to read. */
interface Figure {
  readonly column: string;
  readonly shown: string;
  readonly want: string | undefined;
}

/** Fails on the first figure that reads otherwise. */
function expectFigures(where: string, figures: readonly Figure[]): void {
  for (const { column, shown, want } of figures) {
    if (want !== undefined && shown !== want) {
      throw new Error(
        `expected "${column}" ${where} to read ${quoted(want)}, but it reads ${quoted(shown)}`,
      );
    }
  }
}

function cellFigures(
  cell: ComparisonCell,
  want: ComparisonCellSeen,
): readonly Figure[] {
  return [
    {
      column: "Ausgegeben",
      shown: String(cell.handedOver),
      want: want.handedOver === undefined ? undefined : String(want.handedOver),
    },
    {
      column: "Ø Wartezeit",
      shown: averageText(cell.averageWaitingTimeMs),
      want:
        want.waitingTime === undefined
          ? undefined
          : wantedAverage(want.waitingTime),
    },
    {
      column: "Ø Abholzeit",
      shown: averageText(cell.averagePickupTimeMs),
      want:
        want.pickupTime === undefined
          ? undefined
          : wantedAverage(want.pickupTime),
    },
  ];
}

function shiftOf(state: State, name: ShiftName): Shift {
  const shifts = kirbeShifts(state);
  const shift = shifts.find(
    (s) => s.day === CORE_DAY[name.day] && s.crew === name.crew,
  );
  if (shift === undefined) {
    throw new Error(
      `the Auswertung offers no ${shiftText(name)}: ${
        shifts.length === 0
          ? "it shows no shifts before the first action"
          : "the Festbetrieb plan has no such shift"
      }`,
    );
  }
  return shift;
}

function evaluationRow(
  state: State,
  product: ProductId,
  shift: ShiftName | undefined,
): EvaluationRow {
  const row = evaluationRows(
    state,
    shift === undefined ? undefined : shiftOf(state, shift).id,
  ).find((r) => r.productId === product);
  if (row === undefined) {
    throw new Error(`the Auswertung has no row for ${labelOf(product)}`);
  }
  return row;
}

/** The "Ausverkauft um" cell as the Auswertung writes it. */
function soldOutText(row: EvaluationRow): string {
  const since =
    row.soldOutSince === undefined ? [] : [`seit ${row.soldOutSince}`];
  const at =
    row.soldOutFirstAt === undefined ? [] : [berlinClock(row.soldOutFirstAt)];
  return `${[...since, ...at].join(", ")}${row.soldOutCleared ? " (wieder frei)" : ""}`;
}

function wantedSoldOut(
  state: State,
  soldOut: SoldOutCellSeen | "never",
): string {
  if (soldOut === "never") {
    return "";
  }
  const { at, since, availableAgain = false } = soldOut;
  const parts = [
    ...(since === undefined ? [] : [`seit ${shiftOf(state, since).label}`]),
    ...(at === undefined ? [] : [at]),
  ];
  return `${parts.join(", ")}${availableAgain ? " (wieder frei)" : ""}`;
}

/** Fails unless the product's row in the Auswertung, "Gesamt" or one shift's tab, reads `want`. */
export function expectEvaluationRow(
  state: State,
  product: ProductId,
  shift: ShiftName | undefined,
  want: EvaluationRowSeen,
): void {
  const row = evaluationRow(state, product, shift);
  const where =
    shift === undefined
      ? "in the Auswertung (Gesamt)"
      : `in the Auswertung of ${shiftText(shift)}`;
  expectFigures(`for ${labelOf(product)} ${where}`, [
    {
      column: "Gemacht",
      shown: String(row.made),
      want: want.made === undefined ? undefined : String(want.made),
    },
    ...cellFigures(row, want),
    {
      column: "Ausverkauft um",
      shown: soldOutText(row),
      want:
        want.soldOut === undefined
          ? undefined
          : wantedSoldOut(state, want.soldOut),
    },
  ]);
}

/** The Vergleich's cell for a product, or its "Gesamt" row, in a shift's or a crew's column. */
function comparisonCell(
  state: State,
  column: ShiftName | CrewName,
  product: ProductId | "total",
): ComparisonCell {
  const byShift = "day" in column;
  const comparison = shiftComparison(state, byShift ? "shift" : "crew");
  const label = byShift ? shiftOf(state, column).label : columnName(column);
  const index = comparison.columns.findIndex((c) => c.label === label);
  if (index === -1) {
    throw new Error(`the Vergleich has no column for ${columnName(column)}`);
  }
  const cells =
    product === "total"
      ? comparison.totals
      : comparison.rows.find((r) => r.productId === product)?.cells;
  const cell = cells?.[index];
  if (cell === undefined) {
    throw new Error(
      `the Vergleich has no ${product === "total" ? "Gesamt row" : `row for ${labelOf(product)}`}`,
    );
  }
  return cell;
}

/** Fails unless the Vergleich's cell, a product's or the "Gesamt" row's, reads `want`. */
export function expectComparisonCell(
  state: State,
  column: ShiftName | CrewName,
  product: ProductId | "total",
  want: ComparisonCellSeen,
): void {
  const row = product === "total" ? "Gesamt" : labelOf(product);
  expectFigures(
    `for ${row} in the Vergleich's column ${columnName(column)}`,
    cellFigures(comparisonCell(state, column, product), want),
  );
}
