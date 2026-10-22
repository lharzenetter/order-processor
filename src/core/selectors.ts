import { MENU } from "./menu";
import { PAGER_COUNT, REBUZZ_AFTER_MS } from "./parameters";
import { isOpen, waitingOf } from "./reduce";
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
  /** When the first live `soldOutMarked` happened; absent if never. */
  readonly soldOutFirstAt?: number;
  /** Sold out at some point, but not any more. */
  readonly soldOutCleared: boolean;
}

/** The Auswertung, per product in display order. */
export function evaluationRows(state: State): readonly EvaluationRow[] {
  return MENU.map(({ id, label }) => {
    const lines = state.orders.flatMap((order) =>
      order.lines.filter((line) => line.productId === id),
    );
    const handedOver = sum(lines.map((l) => l.pickedUp));
    const row = {
      productId: id,
      label,
      made: handedOver + sum(lines.map((l) => l.abandoned + l.backToQueue)),
      handedOver,
    };
    const soldOutFirstAt = state.soldOutFirstAt[id];
    return soldOutFirstAt === undefined
      ? { ...row, soldOutCleared: false }
      : {
          ...row,
          soldOutFirstAt,
          soldOutCleared: !state.soldOut.includes(id),
        };
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
