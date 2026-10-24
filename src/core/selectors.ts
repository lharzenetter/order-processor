import { MENU } from "./menu";
import { PAGER_COUNT, REBUZZ_AFTER_MS } from "./parameters";
import type { Event } from "./event";
import { kirbeShifts, shiftRange } from "./kirbe-shifts";
import type { Shift } from "./kirbe-shifts";
import { fold, isOpen, reduce, waitingOf, waitingTimeMs } from "./reduce";
import { INITIAL_STATE } from "./state";
import type { ClosedBy, Line, Order, State } from "./state";

/** An order queued for a product, as a pager chip shows it. */
export interface QueuedOrder {
  readonly orderId: string;
  readonly pager: number;
  readonly waiting: number;
}

export interface BoardRow {
  readonly productId: string;
  readonly label: string;
  readonly soldOut: boolean;
  /** The order the next plate of this product goes to, or `null` when nobody waits. */
  readonly next:
    | (QueuedOrder & {
        /** The x of "x von y gerufen": buzzed or picked up. */
        readonly calledCount: number;
        /** The y: ordered and not cancelled. */
        readonly plateCount: number;
      })
    | null;
  /** The orders behind `next`, in FIFO order. */
  readonly queued: readonly QueuedOrder[];
}

/** The Übersicht: per product in display order, who is next and who queues behind. */
export function boardRows(state: State): readonly BoardRow[] {
  return MENU.map(({ id, label }) => {
    const [first, ...rest] = queueFor(state, id);
    return {
      productId: id,
      label,
      soldOut: state.soldOut.includes(id),
      next:
        first === undefined
          ? null
          : {
              ...queuedOrder(first),
              calledCount: first.line.buzzed + first.line.pickedUp,
              plateCount: first.line.ordered - first.line.cancelled,
            },
      queued: rest.map(queuedOrder),
    };
  });
}

/** The open order with the lowest FIFO place still waiting for the product, optionally skipping one. */
export function nextOrderFor(
  state: State,
  productId: string,
  exceptOrderId?: string,
): Order | null {
  return (
    queueFor(state, productId).find(({ order }) => order.id !== exceptOrderId)
      ?.order ?? null
  );
}

/** Who gets a plate handed on from this order, or `null` when nobody else waits (Weitergeben disabled). */
export function handOnTarget(
  state: State,
  orderId: string,
  productId: string,
): Order | null {
  return nextOrderFor(state, productId, orderId);
}

export interface BuzzedLine {
  readonly orderId: string;
  readonly pager: number;
  readonly productId: string;
  readonly label: string;
  readonly buzzed: number;
  readonly sinceBuzzMs: number;
  readonly rebuzzDue: boolean;
}

/** The Gerufen column: every line with buzzed plates, the earliest buzz clock first. */
export function buzzedLines(state: State, now: number): readonly BuzzedLine[] {
  return state.orders
    .filter(isOpen)
    .flatMap((order) =>
      order.lines.flatMap((line) =>
        line.buzzed > 0 && line.buzzClockFrom !== undefined
          ? [{ order, line, clockFrom: line.buzzClockFrom }]
          : [],
      ),
    )
    .sort((a, b) => a.clockFrom - b.clockFrom)
    .map(({ order, line, clockFrom }) => ({
      orderId: order.id,
      pager: order.pager,
      productId: line.productId,
      label: labelOf(line.productId),
      buzzed: line.buzzed,
      ...buzzClock(clockFrom, now),
    }));
}

/** The open order on a pager, or `null`: the Ausgabe keypad resolves pager → order with it. */
export function openOrderByPager(state: State, pager: number): Order | null {
  return state.orders.find((o) => isOpen(o) && o.pager === pager) ?? null;
}

export interface OrderViewLine {
  readonly productId: string;
  readonly label: string;
  readonly buzzed: number;
  readonly waiting: number;
  readonly soldOut: boolean;
  /** Only while plates are buzzed. */
  readonly sinceBuzzMs?: number;
  readonly rebuzzDue?: boolean;
}

export interface OrderView {
  readonly orderId: string;
  readonly pager: number;
  readonly takenAt: number;
  /** From intake to `now`. */
  readonly waitingTimeMs: number;
  readonly open: boolean;
  readonly closedBy?: ClosedBy;
  /** Only the lines with plates still open, in display order. */
  readonly lines: readonly OrderViewLine[];
}

/** The order popup's content, and after a handover whether the order closed. */
export function orderView(
  state: State,
  orderId: string,
  now: number,
): OrderView | null {
  const order = state.orders.find((o) => o.id === orderId);
  if (order === undefined) {
    return null;
  }
  const lines = order.lines.flatMap((line): OrderViewLine[] => {
    const waiting = waitingOf(line);
    if (line.buzzed + waiting === 0) {
      return [];
    }
    const view = {
      productId: line.productId,
      label: labelOf(line.productId),
      buzzed: line.buzzed,
      waiting,
      soldOut: state.soldOut.includes(line.productId),
    };
    return [
      line.buzzClockFrom === undefined
        ? view
        : { ...view, ...buzzClock(line.buzzClockFrom, now) },
    ];
  });
  const view = {
    orderId: order.id,
    pager: order.pager,
    takenAt: order.takenAt,
    waitingTimeMs: waitingTimeMs(order, now),
    open: isOpen(order),
    lines,
  };
  return order.closedBy === undefined
    ? view
    : { ...view, closedBy: order.closedBy };
}

export interface PagerOverview {
  readonly free: readonly number[];
  readonly missing: readonly number[];
  readonly attached: readonly number[];
  readonly allOut: boolean;
}

/** Each pager is attached (an open order holds it), missing, or free; all ascending. */
export function pagerOverview(state: State): PagerOverview {
  const attached = state.orders
    .filter(isOpen)
    .map((o) => o.pager)
    .sort((a, b) => a - b);
  const free = Array.from({ length: PAGER_COUNT }, (_, i) => i + 1).filter(
    (pager) =>
      !attached.includes(pager) && !state.missingPagers.includes(pager),
  );
  return {
    free,
    missing: state.missingPagers,
    attached,
    allOut: free.length === 0,
  };
}

export function headerCounts(state: State): {
  readonly openOrders: number;
  readonly freePagers: number;
} {
  return {
    openOrders: state.orders.filter(isOpen).length,
    freePagers: pagerOverview(state).free.length,
  };
}

function buzzClock(
  clockFrom: number,
  now: number,
): { readonly sinceBuzzMs: number; readonly rebuzzDue: boolean } {
  const sinceBuzzMs = Math.max(0, now - clockFrom);
  return { sinceBuzzMs, rebuzzDue: sinceBuzzMs >= REBUZZ_AFTER_MS };
}

/** The product's short label. */
export function labelOf(productId: string): string {
  return MENU.find(({ id }) => id === productId)?.label ?? productId;
}

function queueFor(
  state: State,
  productId: string,
): readonly { readonly order: Order; readonly line: Line }[] {
  // `state.orders` is kept in FIFO order.
  return state.orders.flatMap((order) => {
    const line = order.lines.find((l) => l.productId === productId);
    return isOpen(order) && line !== undefined && waitingOf(line) > 0
      ? [{ order, line }]
      : [];
  });
}

function queuedOrder({
  order,
  line,
}: {
  readonly order: Order;
  readonly line: Line;
}): QueuedOrder {
  return { orderId: order.id, pager: order.pager, waiting: waitingOf(line) };
}

export interface SoldOutWaiting {
  readonly productId: string;
  readonly label: string;
  /** In FIFO order; empty when nobody waits. */
  readonly orders: readonly QueuedOrder[];
}

/** The sold-out banner: per sold-out product, the open orders still waiting for it. */
export function soldOutWaiting(state: State): readonly SoldOutWaiting[] {
  return state.soldOut.map((productId) => ({
    productId,
    label: labelOf(productId),
    orders: queueFor(state, productId).map(queuedOrder),
  }));
}

export interface EvaluationRow {
  readonly productId: string;
  readonly label: string;
  /** Plates that came out of the kitchen: picked up, abandoned or sent back to the queue. */
  readonly made: number;
  readonly handedOver: number;
  /** Over every picked-up plate, rounded to whole seconds; absent if none was picked up. */
  readonly averageWaitingTimeMs?: number;
  /** When the first live `soldOutMarked` happened, within the shift for one; absent if never. */
  readonly soldOutFirstAt?: number;
  /** For one shift: sold out since an earlier shift, as that shift's label. */
  readonly soldOutSince?: string;
  /** Sold out at some point, but not any more; for one shift, at its end. */
  readonly soldOutCleared: boolean;
}

/**
 * The Auswertung, per product in display order: of the whole Kirbe, or of the shift with
 * `shiftId`, counting each plate in the shift where it was handed over, sent back or abandoned.
 */
export function evaluationRows(
  state: State,
  shiftId?: string,
): readonly EvaluationRow[] {
  if (shiftId !== undefined) {
    return shiftEvaluationRows(state, shiftId);
  }
  return MENU.map(({ id, label }) => {
    const soldOutFirstAt = state.soldOutFirstAt[id];
    return {
      ...countsRow(id, label, platesOf(state, id)),
      ...(soldOutFirstAt === undefined ? {} : { soldOutFirstAt }),
      soldOutCleared:
        soldOutFirstAt !== undefined && !state.soldOut.includes(id),
    };
  });
}

function shiftEvaluationRows(
  state: State,
  shiftId: string,
): readonly EvaluationRow[] {
  const shifts = kirbeShifts(state);
  const shift = shifts.find((s) => s.id === shiftId);
  if (shift === undefined) {
    throw new Error(`No shift ${shiftId}`);
  }
  const { live } = state;
  const { from, until } = shiftRange(live, shift);
  // Every count only grows, so a shift's share is the difference between its two ends.
  const before = fold(live.slice(0, from));
  const after = fold(live.slice(0, until));
  return MENU.map(({ id, label }) => {
    const mark = live
      .slice(from, until)
      .find((e) => e.type === "soldOutMarked" && e.productId === id);
    const soldOutSince = before.soldOut.includes(id)
      ? shiftOfLastMark(live, from, id, shifts)?.label
      : undefined;
    return {
      ...countsRow(id, label, platesBetween(before, after, id)),
      ...(mark === undefined ? {} : { soldOutFirstAt: mark.at }),
      ...(soldOutSince === undefined ? {} : { soldOutSince }),
      soldOutCleared:
        (mark !== undefined || soldOutSince !== undefined) &&
        !after.soldOut.includes(id),
    };
  });
}

interface Plates {
  readonly made: number;
  readonly handedOver: number;
  readonly waitingTimeMs: number;
}

function platesOf(state: State, productId: string): Plates {
  const lines = state.orders.flatMap((order) =>
    order.lines.filter((line) => line.productId === productId),
  );
  const handedOver = sum(lines.map((l) => l.pickedUp));
  return {
    made: handedOver + sum(lines.map((l) => l.abandoned + l.backToQueue)),
    handedOver,
    waitingTimeMs: sum(lines.map((l) => l.pickedUpWaitingTimeMs)),
  };
}

const NO_PLATES: Plates = { made: 0, handedOver: 0, waitingTimeMs: 0 };

/** The plates of a product counted between two states of the log. */
function platesBetween(before: State, after: State, productId: string): Plates {
  const start = platesOf(before, productId);
  const end = platesOf(after, productId);
  return {
    made: end.made - start.made,
    handedOver: end.handedOver - start.handedOver,
    waitingTimeMs: end.waitingTimeMs - start.waitingTimeMs,
  };
}

function addPlates(plates: readonly Plates[]): Plates {
  return {
    made: sum(plates.map((p) => p.made)),
    handedOver: sum(plates.map((p) => p.handedOver)),
    waitingTimeMs: sum(plates.map((p) => p.waitingTimeMs)),
  };
}

function countsRow(
  productId: string,
  label: string,
  plates: Plates,
): Omit<EvaluationRow, "soldOutCleared"> {
  return { productId, label, made: plates.made, ...cellOf(plates) };
}

function cellOf({ handedOver, waitingTimeMs }: Plates): ComparisonCell {
  return handedOver === 0
    ? { handedOver }
    : {
        handedOver,
        averageWaitingTimeMs:
          Math.round(waitingTimeMs / handedOver / 1000) * 1000,
      };
}

export type ComparisonBy = "crew" | "shift";

export interface ComparisonCell {
  readonly handedOver: number;
  /** Over every picked-up plate, rounded to whole seconds; absent if none was picked up. */
  readonly averageWaitingTimeMs?: number;
}

export interface ComparisonColumn {
  /** The shift's id, or the crew's letter in lower case. */
  readonly id: string;
  readonly label: string;
  /** The shifts it sums: the one shift, or every shift of the crew, in calendar order. */
  readonly shifts: readonly Shift[];
}

export interface Comparison {
  readonly columns: readonly ComparisonColumn[];
  /** Per product in display order, one cell per column. */
  readonly rows: readonly {
    readonly productId: string;
    readonly label: string;
    readonly cells: readonly ComparisonCell[];
  }[];
  /** Every product together, one cell per column. */
  readonly totals: readonly ComparisonCell[];
}

/** The shifts, or the crews, side by side: plates handed over and the average waiting time. */
export function shiftComparison(state: State, by: ComparisonBy): Comparison {
  const shifts = kirbeShifts(state);
  const shares = shiftShares(state.live, shifts);
  const columns =
    by === "shift"
      ? shifts.map((shift) => ({
          id: shift.id,
          label: shift.label,
          shifts: [shift],
        }))
      : [...new Set(shifts.map((shift) => shift.crew))].sort().map((crew) => ({
          id: crew.toLowerCase(),
          label: `Gruppe ${crew}`,
          shifts: shifts.filter((shift) => shift.crew === crew),
        }));
  function platesIn(
    column: ComparisonColumn,
    productIds: readonly string[],
  ): Plates {
    return addPlates(
      column.shifts.flatMap((shift) =>
        productIds.map((id) => shares.get(shift.id)?.get(id) ?? NO_PLATES),
      ),
    );
  }
  return {
    columns,
    rows: MENU.map(({ id, label }) => ({
      productId: id,
      label,
      cells: columns.map((column) => cellOf(platesIn(column, [id]))),
    })),
    totals: columns.map((column) =>
      cellOf(
        platesIn(
          column,
          MENU.map(({ id }) => id),
        ),
      ),
    ),
  };
}

/** Per shift id, per product id, the shift's share of the plates, folding the log only once. */
function shiftShares(
  live: readonly Event[],
  shifts: readonly Shift[],
): ReadonlyMap<string, ReadonlyMap<string, Plates>> {
  const shares = new Map<string, ReadonlyMap<string, Plates>>();
  let before = INITIAL_STATE;
  let done = 0;
  // The ranges follow on from each other, so each shift folds on from the one before.
  for (const shift of shifts) {
    const { until } = shiftRange(live, shift);
    const after = live.slice(done, until).reduce(reduce, before);
    shares.set(
      shift.id,
      new Map(MENU.map(({ id }) => [id, platesBetween(before, after, id)])),
    );
    before = after;
    done = until;
  }
  return shares;
}

/** The shift of the last `soldOutMarked` for the product among the first `count` live events. */
function shiftOfLastMark(
  live: readonly Event[],
  count: number,
  productId: string,
  shifts: readonly Shift[],
): Shift | undefined {
  const index = live
    .slice(0, count)
    .map((e) => e.type === "soldOutMarked" && e.productId === productId)
    .lastIndexOf(true);
  return shifts.find((shift) => {
    const { from, until } = shiftRange(live, shift);
    return index >= from && index < until;
  });
}

export interface OpenOrdersListEntry {
  readonly orderId: string;
  readonly pager: number;
  readonly lines: readonly {
    readonly productId: string;
    readonly label: string;
    /** Plates the guest is still owed, buzzed ones included. */
    readonly owed: number;
    readonly buzzed: number;
  }[];
}

/** The paper fallback: open orders sorted by pager, with what each is still owed. */
export function openOrdersList(state: State): readonly OpenOrdersListEntry[] {
  return state.orders
    .filter(isOpen)
    .sort((a, b) => a.pager - b.pager)
    .map((order) => ({
      orderId: order.id,
      pager: order.pager,
      lines: order.lines.flatMap((line) => {
        const owed = line.buzzed + waitingOf(line);
        return owed === 0
          ? []
          : [
              {
                productId: line.productId,
                label: labelOf(line.productId),
                owed,
                buzzed: line.buzzed,
              },
            ];
      }),
    }));
}

export interface WaitingPlatesRow {
  readonly productId: string;
  readonly label: string;
  readonly waiting: number;
}

/** The Küchenanzeige: per product in the product selection, the plates open orders wait for. */
export function waitingPlates(
  state: State,
  productSelection: readonly string[],
): readonly WaitingPlatesRow[] {
  return MENU.filter(({ id }) => productSelection.includes(id)).map(
    ({ id, label }) => ({
      productId: id,
      label,
      waiting: sum(queueFor(state, id).map(({ line }) => waitingOf(line))),
    }),
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * What intake does with a typed pager: `attached` is rejected, `missing` warns and restores the
 * pager when the order is still started (05-exceptions).
 */
export type PagerCheck =
  "empty" | "outOfRange" | "attached" | "missing" | "free";

export function pagerCheck(state: State, pager: number | null): PagerCheck {
  if (pager === null) {
    return "empty";
  }
  if (!Number.isInteger(pager) || pager < 1 || pager > PAGER_COUNT) {
    return "outOfRange";
  }
  if (openOrderByPager(state, pager) !== null) {
    return "attached";
  }
  return state.missingPagers.includes(pager) ? "missing" : "free";
}

/** Whether intake may start an order on a pager with this check. */
export function acceptsIntake(check: PagerCheck): boolean {
  return check === "free" || check === "missing";
}
