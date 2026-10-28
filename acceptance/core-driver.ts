import {
  acceptsIntake,
  boardRows,
  buzzedLines,
  evaluationRows,
  fold,
  handOnTarget,
  kirbeShifts,
  labelOf,
  nextOrderFor,
  openOrderByPager,
  openOrdersList,
  orderView,
  pagerCheck,
  pagerOverview,
  shiftComparison,
  soldOutWaiting,
  undoTarget,
} from "../src/core";
import type {
  ComparisonCell,
  Event,
  EventBody,
  EvaluationRow,
  KirbeDay,
  Order,
  OrderViewLine,
  PlateCount,
  ProductId,
  Shift,
  State,
} from "../src/core";
import type {
  AverageSeen,
  BuzzedLineRef,
  BuzzedLineSeen,
  ComparisonCellSeen,
  CrewName,
  Duration,
  EvaluationRowSeen,
  KirbeDayName,
  LineSeen,
  OpenOrderSeen,
  Plates,
  ShiftName,
  SoldOutCellSeen,
  SoldOutOrderSeen,
  Steps,
  Window,
} from "./window";

/** A line of the buzzed list as staff read it. */
interface BuzzedRow {
  readonly pager: number;
  readonly product: ProductId;
  readonly plates: number;
  readonly sinceMs: number;
  readonly rebuzzDue: boolean;
}

function msOf({ minutes = 0, seconds = 0 }: Duration): number {
  return (minutes * 60 + seconds) * 1000;
}

/** "4:05", as the buzzed list's clock reads; the screen drops part-seconds. */
function clockOf(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

// This Kirbe runs Samstag 24. to Montag 26. Oktober 2026, so its Sunday night has the end of summer
// time, as the shift tests in the core have.
const KIRBE_SATURDAY = { year: 2026, month: 10, day: 24 } as const;

const DAY_OFFSET: Readonly<Record<KirbeDayName, number>> = {
  Samstag: 0,
  Sonntag: 1,
  Montag: 2,
};

const CORE_DAY: Readonly<Record<KirbeDayName, KirbeDay>> = {
  Samstag: "samstag",
  Sonntag: "sonntag",
  Montag: "montag",
};

const HOUR_MS = 60 * 60_000;

// The Kirbe is in Berlin whatever the machine running the scenarios is set to.
const BERLIN = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  weekday: "long",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function berlinParts(at: number): Readonly<Record<string, string>> {
  return Object.fromEntries(
    BERLIN.formatToParts(at).map((part) => [part.type, part.value]),
  );
}

/** "11:30", as the Auswertung shows a time of day. */
function berlinClock(at: number): string {
  const { hour = "", minute = "" } = berlinParts(at);
  return `${hour}:${minute}`;
}

/** "Samstag 11:30", as a scenario writes it. */
function dayAndTimeOf(at: number): string {
  return `${berlinParts(at).weekday ?? ""} ${berlinClock(at)}`;
}

function isKirbeDay(day: string): day is KirbeDayName {
  return day in DAY_OFFSET;
}

/** The instant of "Samstag 11:30" on this Kirbe's calendar; refuses an hour that is not one. */
function kirbeAt(dayAndTime: string): number {
  const match = /^(Samstag|Sonntag|Montag) (\d{1,2}):(\d{2})$/.exec(dayAndTime);
  const [, day, hour, minute] = match ?? [];
  if (
    day === undefined ||
    !isKirbeDay(day) ||
    hour === undefined ||
    minute === undefined ||
    Number(hour) > 23 ||
    Number(minute) > 59
  ) {
    throw new Error(
      `"${dayAndTime}" is no time on the Kirbe: write a Kirbe day and a time, as in "Samstag 11:30"`,
    );
  }
  const offset = DAY_OFFSET[day];
  // Berlin is two hours ahead in summer time and one in winter time; keep what reads back right.
  const candidates = [2, 1]
    .map(
      (ahead) =>
        Date.UTC(
          KIRBE_SATURDAY.year,
          KIRBE_SATURDAY.month - 1,
          KIRBE_SATURDAY.day + offset,
          Number(hour),
          Number(minute),
        ) -
        ahead * HOUR_MS,
    )
    .filter(
      (at) => dayAndTimeOf(at) === `${day} ${hour.padStart(2, "0")}:${minute}`,
    );
  const [at, twice] = candidates;
  if (at === undefined) {
    throw new Error(`"${dayAndTime}" never happens: the clocks skip that hour`);
  }
  if (twice !== undefined) {
    throw new Error(
      `"${dayAndTime}" happens twice: the clocks go back from 03:00 to 02:00 that night`,
    );
  }
  return at;
}

// Every scenario starts when the Kirbe opens (#8).
const START_AT = kirbeAt("Samstag 10:00");

/** "Samstag · Gruppe A", as the Festbetrieb plan names a shift. */
function shiftText({ day, crew }: ShiftName): string {
  return `${day} · Gruppe ${crew}`;
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

/** Runs a scenario on `fold` and the selectors: the same reads the UI makes (#7). */
export function coreWindow(): Window {
  const events: Event[] = [];
  let state: State = fold([]);
  let now = START_AT;

  /** Stamps the tap as the ui does: the device name only on a named iPad. */
  function record(body: EventBody, device: string | undefined): void {
    const seq = events.length + 1;
    const event: Event = {
      ...body,
      id: `e${String(seq)}`,
      seq,
      at: now,
      ...(device === undefined ? {} : { device }),
    };
    const next = [...events, event];
    // A throw here means the driver let through a step the UI would not offer.
    state = fold(next);
    events.splice(0, events.length, ...next);
  }

  function openOrder(pager: number): Order {
    const order = openOrderByPager(state, pager);
    if (order === null) {
      throw new Error(`pager ${String(pager)} has no open order`);
    }
    return order;
  }

  function linesOf(pager: number): readonly OrderViewLine[] {
    return orderView(state, openOrder(pager).id, now)?.lines ?? [];
  }

  function pagerState(pager: number): string {
    const overview = pagerOverview(state);
    if (overview.attached.includes(pager)) {
      return "with the guest";
    }
    return overview.missing.includes(pager) ? "missing" : "free";
  }

  /** Fails unless the pager's tile in the "Pager fehlt…" mode would do what the step means. */
  function expectMissingModeTile(
    pager: number,
    want: "free" | "missing",
  ): void {
    const check = pagerCheck(state, pager);
    if (check === "outOfRange") {
      throw new Error(`intake's pager grid has no pager ${String(pager)}`);
    }
    if (check !== want) {
      throw new Error(
        `intake's "Pager fehlt…" mode offers no ${want === "free" ? "marking" : "restoring"} of pager ${String(pager)}: it is ${pagerState(pager)}`,
      );
    }
  }

  function checkLines(
    pager: number,
    expected: Partial<Readonly<Record<ProductId, LineSeen>>>,
    exact: boolean,
  ): void {
    const lines = linesOf(pager);
    for (const [productId, seen] of Object.entries(expected)) {
      const line = lines.find((l) => l.productId === productId);
      const what = `pager ${String(pager)}'s order`;
      if (line === undefined) {
        throw new Error(
          `expected ${what} to have ${labelOf(productId)}, but it has none open`,
        );
      }
      for (const field of ["buzzed", "waiting"] as const) {
        const want = exact ? (seen[field] ?? 0) : seen[field];
        if (want !== undefined && line[field] !== want) {
          throw new Error(
            `expected ${what} to have ${String(want)} ${labelOf(productId)} ${field}, but it has ${String(line[field])}`,
          );
        }
      }
    }
    const extra = lines.filter((l) => !(l.productId in expected));
    if (exact && extra.length > 0) {
      throw new Error(
        `expected pager ${String(pager)}'s order to have nothing else, but it also has ${extra.map((l) => l.label).join(", ")}`,
      );
    }
  }

  function describeBuzzed(line: BuzzedLineSeen): string {
    const plates = line.plates === undefined ? "" : ` ×${String(line.plates)}`;
    const since =
      line.since === undefined ? "" : ` since ${clockOf(msOf(line.since))}`;
    return `pager ${String(line.pager)} ${labelOf(line.product)}${plates}${since}`;
  }

  function describeRow(row: BuzzedRow): string {
    return describeBuzzed({ ...row, since: { seconds: row.sinceMs / 1000 } });
  }

  function buzzedListRows(): readonly BuzzedRow[] {
    return buzzedLines(state, now).map((l) => ({
      pager: l.pager,
      // The selector widens ids to string; a scenario only compares them.
      product: l.productId as ProductId,
      plates: l.buzzed,
      sinceMs: l.sinceBuzzMs,
      rebuzzDue: l.rebuzzDue,
    }));
  }

  function matches(row: BuzzedRow, want: BuzzedLineSeen): boolean {
    return (
      row.pager === want.pager &&
      row.product === want.product &&
      (want.plates === undefined || row.plates === want.plates) &&
      (want.since === undefined ||
        clockOf(row.sinceMs) === clockOf(msOf(want.since)))
    );
  }

  function buzzedRow({ pager, product }: BuzzedLineRef): BuzzedRow {
    const row = buzzedListRows().find(
      (r) => r.pager === pager && r.product === product,
    );
    if (row === undefined) {
      throw new Error(
        `the buzzed list has no line for pager ${String(pager)} ${labelOf(product)}`,
      );
    }
    return row;
  }

  function buzzedOf(pager: number, product: ProductId): number {
    return linesOf(pager).find((l) => l.productId === product)?.buzzed ?? 0;
  }

  /** Who the "Weitergeben" button names, or why the popup offers none. */
  function handOnTo(pager: number, product: ProductId): Order | string {
    if (buzzedOf(pager, product) === 0) {
      return `pager ${String(pager)} has no ${labelOf(product)} buzzed`;
    }
    return (
      handOnTarget(state, openOrder(pager).id, product) ??
      `nobody else waits for ${labelOf(product)}`
    );
  }

  function waitingOf(pager: number, product: ProductId): number {
    return linesOf(pager).find((l) => l.productId === product)?.waiting ?? 0;
  }

  function boardRow(product: ProductId) {
    const row = boardRows(state).find((r) => r.productId === product);
    if (row === undefined) {
      throw new Error(`the board has no row for ${labelOf(product)}`);
    }
    return row;
  }

  function isSoldOut(product: ProductId): boolean {
    // Intake and the board both read the sold-out mark; the board row is its selector.
    return boardRow(product).soldOut;
  }

  function soldOutOrders(product: ProductId): readonly SoldOutOrderSeen[] {
    const banner = soldOutWaiting(state).find((b) => b.productId === product);
    if (banner === undefined) {
      throw new Error(
        `expected a sold-out banner for ${labelOf(product)}, but it is not sold out`,
      );
    }
    return banner.orders.map((o) => ({ pager: o.pager, plates: o.waiting }));
  }

  function chipsText(orders: readonly SoldOutOrderSeen[]): string {
    return orders.length === 0
      ? "nobody"
      : orders
          .map(
            ({ pager, plates }) =>
              `pager ${String(pager)}${plates === undefined ? "" : ` ×${String(plates)}`}`,
          )
          .join(", ");
  }

  /** The list as staff read it: owed plates split into buzzed and the rest still waiting. */
  function openOrdersRows(): readonly OpenOrderSeen[] {
    return openOrdersList(state).map(({ pager, lines }) => ({
      pager,
      lines: Object.fromEntries(
        lines.map((l) => [
          l.productId,
          { buzzed: l.buzzed, waiting: l.owed - l.buzzed },
        ]),
      ),
    }));
  }

  function countsOf(
    lines: OpenOrderSeen["lines"],
    product: string,
  ): readonly [number, number] {
    const line = Object.entries(lines).find(([p]) => p === product)?.[1];
    return [line?.buzzed ?? 0, line?.waiting ?? 0];
  }

  function sameOpenOrder(row: OpenOrderSeen, want: OpenOrderSeen): boolean {
    const products = new Set([
      ...Object.keys(row.lines),
      ...Object.keys(want.lines),
    ]);
    return (
      row.pager === want.pager &&
      [...products].every((product) => {
        const [buzzed, waiting] = countsOf(row.lines, product);
        const [wantBuzzed, wantWaiting] = countsOf(want.lines, product);
        return buzzed === wantBuzzed && waiting === wantWaiting;
      })
    );
  }

  function describeOpenOrder({ pager, lines }: OpenOrderSeen): string {
    const owed = Object.entries(lines).map(([product, line]) => {
      const buzzed = line.buzzed ?? 0;
      const total = buzzed + (line.waiting ?? 0);
      return `${String(total)}× ${labelOf(product)}${buzzed > 0 ? ` (${String(buzzed)} buzzed)` : ""}`;
    });
    return `pager ${String(pager)}: ${owed.join(", ")}`;
  }

  function pagersText(pagers: readonly number[]): string {
    return pagers.length === 0
      ? "nobody"
      : `pager ${pagers.map(String).join(", ")}`;
  }

  function offersBuzz(order: Order, productId: ProductId): boolean {
    return nextOrderFor(state, productId)?.id === order.id;
  }

  function toPlateCounts(plates: Plates): PlateCount[] {
    return Object.entries(plates).flatMap(([productId, count]) =>
      count === 0 ? [] : [{ productId, count }],
    );
  }

  /** The first product the Ausgabe stepper cannot reach, or `null` when it allows every plate. */
  function beyondStepper(pager: number, plates: Plates): PlateCount | null {
    const lines = linesOf(pager);
    return (
      toPlateCounts(plates).find(({ productId, count }) => {
        const line = lines.find((l) => l.productId === productId);
        return count > (line === undefined ? 0 : line.buzzed + line.waiting);
      }) ?? null
    );
  }

  function shiftOf(name: ShiftName): Shift {
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
    product: ProductId,
    shift: ShiftName | undefined,
  ): EvaluationRow {
    const row = evaluationRows(
      state,
      shift === undefined ? undefined : shiftOf(shift).id,
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

  function wantedSoldOut(soldOut: SoldOutCellSeen | "never"): string {
    if (soldOut === "never") {
      return "";
    }
    const { at, since, availableAgain = false } = soldOut;
    const parts = [
      ...(since === undefined ? [] : [`seit ${shiftOf(since).label}`]),
      ...(at === undefined ? [] : [at]),
    ];
    return `${parts.join(", ")}${availableAgain ? " (wieder frei)" : ""}`;
  }

  function evaluationFigures(
    row: EvaluationRow,
    want: EvaluationRowSeen,
  ): readonly Figure[] {
    return [
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
          want.soldOut === undefined ? undefined : wantedSoldOut(want.soldOut),
      },
    ];
  }

  /** The Vergleich's cell for a product, or its "Gesamt" row, in a shift's or a crew's column. */
  function comparisonCell(
    column: ShiftName | CrewName,
    product: ProductId | "total",
  ): ComparisonCell {
    const byShift = "day" in column;
    const comparison = shiftComparison(state, byShift ? "shift" : "crew");
    const label = byShift ? shiftOf(column).label : `Gruppe ${column.crew}`;
    const index = comparison.columns.findIndex((c) => c.label === label);
    const name = byShift ? shiftText(column) : label;
    if (index === -1) {
      throw new Error(`the Vergleich has no column for ${name}`);
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

  /** The line's "Wartezeit" or "Abholzeit" in the order popup, as "m:ss". */
  function expectLineTime(
    pager: number,
    product: ProductId,
    which: "Wartezeit" | "Abholzeit",
    want: Duration,
  ): Promise<void> {
    const line = linesOf(pager).find((l) => l.productId === product);
    const shownMs =
      which === "Wartezeit" ? line?.waitingTimeMs : line?.pickupTimeMs;
    const what = `pager ${String(pager)}'s order to show ${which} ${clockOf(msOf(want))} for ${labelOf(product)}`;
    if (shownMs === undefined) {
      throw new Error(
        `expected ${what}, but it shows none: ${
          which === "Wartezeit" ? "no plate is waiting" : "no plate is buzzed"
        }`,
      );
    }
    if (clockOf(shownMs) !== clockOf(msOf(want))) {
      throw new Error(`expected ${what}, but it shows ${clockOf(shownMs)}`);
    }
    return Promise.resolve();
  }

  /** The steps on one iPad; every iPad acts on the same shared log. */
  function stepsOn(device: string | undefined): Steps {
    function append(body: EventBody): void {
      record(body, device);
    }
    return {
      takeOrder({ pager, plates }) {
        if (!acceptsIntake(pagerCheck(state, pager))) {
          throw new Error(
            `intake does not offer pager ${String(pager)}: it is ${pagerState(pager)}`,
          );
        }
        append({ type: "orderTaken", pager, plates: toPlateCounts(plates) });
        return Promise.resolve();
      },
      buzz({ pager, product, count = 1 }) {
        const order = openOrder(pager);
        const taps = count === "all" ? 1 : count;
        for (let tap = 0; tap < taps; tap++) {
          if (!offersBuzz(order, product)) {
            const next = nextOrderFor(state, product);
            throw new Error(
              `the board offers no "Pager ${String(pager)} rufen" for ${labelOf(product)}: ${
                next === null
                  ? "nobody waits for it"
                  : `pager ${String(next.pager)} is next`
              }`,
            );
          }
          const waiting = waitingOf(pager, product);
          append({
            type: "platesBuzzed",
            orderId: order.id,
            productId: product,
            count: count === "all" ? waiting : 1,
          });
        }
        return Promise.resolve();
      },
      handOver({ pager, plates }) {
        const order = openOrder(pager);
        const beyond = beyondStepper(pager, plates);
        if (beyond !== null) {
          throw new Error(
            `the Ausgabe for pager ${String(pager)} cannot reach ${String(beyond.count)}× ${labelOf(beyond.productId)}`,
          );
        }
        append({
          type: "platesHandedOver",
          orderId: order.id,
          plates: toPlateCounts(plates),
        });
        return Promise.resolve();
      },
      handOn({ from, product }) {
        const target = handOnTo(from, product);
        if (typeof target === "string") {
          throw new Error(
            `the order popup for pager ${String(from)} offers no "${labelOf(product)} weitergeben": ${target}`,
          );
        }
        append({
          type: "plateHandedOn",
          fromOrderId: openOrder(from).id,
          toOrderId: target.id,
          productId: product,
        });
        return Promise.resolve();
      },
      sendBackToQueue({ pager, product }) {
        if (buzzedOf(pager, product) === 0) {
          throw new Error(
            `the order popup for pager ${String(pager)} offers no "${labelOf(product)} zurück in Warteschlange": none is buzzed`,
          );
        }
        append({
          type: "plateSentBackToQueue",
          orderId: openOrder(pager).id,
          productId: product,
        });
        return Promise.resolve();
      },
      rebuzz(line) {
        buzzedRow(line);
        append({
          type: "rebuzzed",
          orderId: openOrder(line.pager).id,
          productId: line.product,
        });
        return Promise.resolve();
      },
      cancel({ pager, product, count }) {
        for (let tap = 0; tap < count; tap++) {
          if (waitingOf(pager, product) === 0) {
            throw new Error(
              `the order popup for pager ${String(pager)} offers no "1 ${labelOf(product)} stornieren": none is waiting`,
            );
          }
          append({
            type: "platesCancelled",
            orderId: openOrder(pager).id,
            productId: product,
            count: 1,
          });
        }
        return Promise.resolve();
      },
      markSoldOut(product) {
        if (isSoldOut(product)) {
          throw new Error(
            `the Ausverkauft markieren dialog shows ${labelOf(product)} as sold out already: a tap would clear it`,
          );
        }
        append({ type: "soldOutMarked", productId: product });
        return Promise.resolve();
      },
      clearSoldOut(product) {
        if (!isSoldOut(product)) {
          throw new Error(
            `the Ausverkauft markieren dialog shows ${labelOf(product)} as not sold out: a tap would mark it`,
          );
        }
        append({ type: "soldOutCleared", productId: product });
        return Promise.resolve();
      },
      abandonOrder({ pager, pagerBack }) {
        append({
          type: "orderAbandoned",
          orderId: openOrder(pager).id,
          pagerBack,
        });
        return Promise.resolve();
      },
      markPagerMissing(pager) {
        expectMissingModeTile(pager, "free");
        append({ type: "pagerMarkedMissing", pager });
        return Promise.resolve();
      },
      restorePager(pager) {
        expectMissingModeTile(pager, "missing");
        append({ type: "pagerRestored", pager });
        return Promise.resolve();
      },
      undo() {
        const target = undoTarget(state);
        if (target === null) {
          throw new Error(
            "the Rückgängig button is disabled: there is nothing to undo",
          );
        }
        append({ type: "actionUndone", targetId: target.event.id });
        return Promise.resolve();
      },
    };
  }

  function undoLabel(): string | null {
    return undoTarget(state)?.label ?? null;
  }

  return {
    staff: {
      ...stepsOn(undefined),
      ipad: (deviceName) => stepsOn(deviceName),
    },
    see: {
      order({ pager }) {
        return {
          has(lines) {
            checkLines(pager, lines, false);
            return Promise.resolve();
          },
          hasOnly(lines) {
            checkLines(pager, lines, true);
            return Promise.resolve();
          },
          cannotBuzz(product) {
            if (offersBuzz(openOrder(pager), product)) {
              throw new Error(
                `expected the board to offer no "Pager ${String(pager)} rufen" for ${labelOf(product)}, but it does`,
              );
            }
            return Promise.resolve();
          },
          cannotHandOver(plates) {
            if (beyondStepper(pager, plates) === null) {
              throw new Error(
                `expected the Ausgabe for pager ${String(pager)} to stop short, but it allows every plate`,
              );
            }
            return Promise.resolve();
          },
          cannotHandOn(product) {
            const target = handOnTo(pager, product);
            if (typeof target !== "string") {
              throw new Error(
                `expected the order popup for pager ${String(pager)} to offer no "${labelOf(product)} weitergeben", but it hands on to pager ${String(target.pager)}`,
              );
            }
            return Promise.resolve();
          },
          cannotCancel(product) {
            const waiting = waitingOf(pager, product);
            if (waiting > 0) {
              throw new Error(
                `expected the order popup for pager ${String(pager)} to offer no "1 ${labelOf(product)} stornieren", but ${String(waiting)} ${waiting === 1 ? "is" : "are"} waiting`,
              );
            }
            return Promise.resolve();
          },
          showsWaitingTime: (product, waitingTime) =>
            expectLineTime(pager, product, "Wartezeit", waitingTime),
          showsPickupTime: (product, pickupTime) =>
            expectLineTime(pager, product, "Abholzeit", pickupTime),
        };
      },
      pager(pager) {
        function expectState(want: string): Promise<void> {
          const actual = pagerState(pager);
          if (actual !== want) {
            throw new Error(
              `expected pager ${String(pager)} to be ${want}, but it is ${actual}`,
            );
          }
          return Promise.resolve();
        }
        return {
          isWithTheGuest: () => expectState("with the guest"),
          isFree: () => expectState("free"),
          isMissing: () => expectState("missing"),
        };
      },
      buzzedList() {
        return {
          lists(lines) {
            const rows = buzzedListRows();
            const same =
              rows.length === lines.length &&
              lines.every((want, i) => {
                const row = rows[i];
                return row !== undefined && matches(row, want);
              });
            if (!same) {
              throw new Error(
                `expected the buzzed list to list ${lines.map(describeBuzzed).join(", ") || "nothing"}, but it lists ${rows.map(describeRow).join(", ") || "nothing"}`,
              );
            }
            return Promise.resolve();
          },
          includes(line) {
            const rows = buzzedListRows();
            if (!rows.some((row) => matches(row, line))) {
              throw new Error(
                `expected the buzzed list to include ${describeBuzzed(line)}, but it lists ${rows.map(describeRow).join(", ") || "nothing"}`,
              );
            }
            return Promise.resolve();
          },
          isEmpty() {
            const rows = buzzedListRows();
            if (rows.length > 0) {
              throw new Error(
                `expected the buzzed list to be empty, but it lists ${rows.map(describeRow).join(", ")}`,
              );
            }
            return Promise.resolve();
          },
          rebuzzDueFor(line) {
            const row = buzzedRow(line);
            if (!row.rebuzzDue) {
              throw new Error(
                `expected a re-buzz to be due for ${describeBuzzed(line)}, but its clock reads ${clockOf(row.sinceMs)}`,
              );
            }
            return Promise.resolve();
          },
          noRebuzzDueFor(line) {
            const row = buzzedRow(line);
            if (row.rebuzzDue) {
              throw new Error(
                `expected no re-buzz to be due for ${describeBuzzed(line)}, but its clock reads ${clockOf(row.sinceMs)}`,
              );
            }
            return Promise.resolve();
          },
        };
      },
      board(product) {
        const label = labelOf(product);
        return {
          has({ next, queued }) {
            const row = boardRow(product);
            if (next !== undefined && row.next?.pager !== next) {
              throw new Error(
                `expected the board to show pager ${String(next)} next for ${label}, but ${
                  row.next === null
                    ? "nobody waits"
                    : `it shows pager ${String(row.next.pager)}`
                }`,
              );
            }
            const behind = row.queued.map((q) => q.pager);
            if (
              queued !== undefined &&
              (behind.length !== queued.length ||
                queued.some((pager, i) => behind[i] !== pager))
            ) {
              throw new Error(
                `expected the board to queue ${pagersText(queued)} behind for ${label}, but it queues ${pagersText(behind)}`,
              );
            }
            return Promise.resolve();
          },
          nobodyWaits() {
            const { next } = boardRow(product);
            if (next !== null) {
              throw new Error(
                `expected nobody to wait for ${label} on the board, but pager ${String(next.pager)} is next`,
              );
            }
            return Promise.resolve();
          },
          isSoldOut() {
            if (!isSoldOut(product)) {
              throw new Error(
                `expected the board to mark ${label} sold out, but it does not`,
              );
            }
            return Promise.resolve();
          },
          isNotSoldOut() {
            if (isSoldOut(product)) {
              throw new Error(
                `expected the board not to mark ${label} sold out, but it does`,
              );
            }
            return Promise.resolve();
          },
        };
      },
      soldOut(product) {
        const label = labelOf(product);
        return {
          lists(orders) {
            const shown = soldOutOrders(product);
            const same =
              shown.length === orders.length &&
              orders.every((want, i) => {
                const chip = shown[i];
                return (
                  chip?.pager === want.pager &&
                  (want.plates === undefined || chip.plates === want.plates)
                );
              });
            if (!same) {
              throw new Error(
                `expected the ${label} sold-out banner to list ${chipsText(orders)}, but it lists ${chipsText(shown)}`,
              );
            }
            return Promise.resolve();
          },
          nobodyWaits() {
            const shown = soldOutOrders(product);
            if (shown.length > 0) {
              throw new Error(
                `expected the ${label} sold-out banner to read "niemand wartet", but it lists ${chipsText(shown)}`,
              );
            }
            return Promise.resolve();
          },
        };
      },
      openOrdersList() {
        return {
          lists(orders) {
            const rows = openOrdersRows();
            const same =
              rows.length === orders.length &&
              orders.every((want, i) => {
                const row = rows[i];
                return row !== undefined && sameOpenOrder(row, want);
              });
            if (!same) {
              throw new Error(
                `expected the Offene Bestellungen list to show ${orders.map(describeOpenOrder).join("; ") || "nothing"}, but it shows ${rows.map(describeOpenOrder).join("; ") || "nothing"}`,
              );
            }
            return Promise.resolve();
          },
        };
      },
      intake() {
        function check(pager: number, accepts: boolean): Promise<void> {
          if (acceptsIntake(pagerCheck(state, pager)) !== accepts) {
            throw new Error(
              `expected intake to ${accepts ? "accept" : "refuse"} pager ${String(pager)}, but it is ${pagerState(pager)}`,
            );
          }
          return Promise.resolve();
        }
        function warns(product: ProductId, want: boolean): Promise<void> {
          if (isSoldOut(product) !== want) {
            throw new Error(
              want
                ? `expected intake to warn that ${labelOf(product)} is sold out, but it is not`
                : `expected intake to take ${labelOf(product)} without a warning, but it is sold out`,
            );
          }
          return Promise.resolve();
        }
        return {
          refusesPager: (pager) => check(pager, false),
          acceptsPager: (pager) => check(pager, true),
          warnsSoldOut: (product) => warns(product, true),
          noSoldOutWarningFor: (product) => warns(product, false),
        };
      },
      undo() {
        return {
          offers(label) {
            const shown = undoLabel();
            if (shown !== label) {
              throw new Error(
                `expected Rückgängig to name "${label}", but ${shown === null ? "there is nothing to undo" : `it names "${shown}"`}`,
              );
            }
            return Promise.resolve();
          },
          offersNothing() {
            const shown = undoLabel();
            if (shown !== null) {
              throw new Error(
                `expected nothing to undo, but Rückgängig names "${shown}"`,
              );
            }
            return Promise.resolve();
          },
        };
      },
      evaluation(shift) {
        const where =
          shift === undefined
            ? "in the Auswertung (Gesamt)"
            : `in the Auswertung of ${shiftText(shift)}`;
        return {
          row(product) {
            return {
              has(want) {
                expectFigures(
                  `for ${labelOf(product)} ${where}`,
                  evaluationFigures(evaluationRow(product, shift), want),
                );
                return Promise.resolve();
              },
            };
          },
        };
      },
      comparison(column) {
        const name =
          "day" in column ? shiftText(column) : `Gruppe ${column.crew}`;
        return {
          row(product) {
            return {
              has(want) {
                expectFigures(
                  `for ${labelOf(product)} in the Vergleich's column ${name}`,
                  cellFigures(comparisonCell(column, product), want),
                );
                return Promise.resolve();
              },
            };
          },
          total() {
            return {
              has(want) {
                expectFigures(
                  `for Gesamt in the Vergleich's column ${name}`,
                  cellFigures(comparisonCell(column, "total"), want),
                );
                return Promise.resolve();
              },
            };
          },
        };
      },
    },
    time: {
      passes(duration) {
        now += msOf(duration);
        return Promise.resolve();
      },
      isNow(dayAndTime) {
        const at = kirbeAt(dayAndTime);
        if (at < now) {
          throw new Error(
            `time only moves forward: it is ${dayAndTimeOf(now)} already, past ${dayAndTime}`,
          );
        }
        now = at;
        return Promise.resolve();
      },
    },
  };
}
