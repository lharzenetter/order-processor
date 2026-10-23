import { assertNever } from "./assert-never";
import type { Event, PlateCount } from "./event";
import { MENU } from "./menu";
import { PAGER_COUNT } from "./parameters";
import { INITIAL_STATE } from "./state";
import type { ClosedBy, Line, Order, State } from "./state";

/** Folds a whole event log, undos included, into state. Throws if the log breaks an invariant. */
export function fold(events: readonly Event[]): State {
  return events.reduce(reduce, INITIAL_STATE);
}

/**
 * Applies one event. Throws on an invariant violation from the event catalog: the ui disables
 * actions that would violate one, so a throw means a bug.
 */
export function reduce(state: State, event: Event): State {
  if (event.type === "actionUndone") {
    // A strict stack: the target is always the newest live event, so refolding the rest always
    // gives a valid state (spec, "Undo").
    const target = state.live.at(-1);
    if (target?.id !== event.targetId) {
      throw new Error(`Undo target ${event.targetId} is not the newest event`);
    }
    return state.live.slice(0, -1).reduce(reduce, INITIAL_STATE);
  }
  const next = apply(state, event);
  return { ...next, live: [...state.live, event] };
}

function apply(
  state: State,
  event: Exclude<Event, { type: "actionUndone" }>,
): State {
  switch (event.type) {
    case "orderTaken":
      return takeOrder(state, event);
    case "platesBuzzed":
      return buzzPlates(state, event);
    case "plateHandedOn":
      return handOn(state, event);
    case "plateSentBackToQueue":
      return sendBackToQueue(state, event);
    case "rebuzzed":
      return rebuzz(state, event);
    case "platesHandedOver":
      return handOver(state, event);
    case "platesCancelled":
      return cancelPlates(state, event);
    case "orderAbandoned":
      return abandonOrder(state, event);
    case "pagerMarkedMissing":
      return markPagerMissing(state, event.pager);
    case "pagerRestored":
      return restorePager(state, event.pager);
    case "soldOutMarked":
      return markSoldOut(state, event.productId, event.at);
    case "soldOutCleared":
      return clearSoldOut(state, event.productId);
    default:
      return assertNever(event);
  }
}

function takeOrder(
  state: State,
  event: Extract<Event, { type: "orderTaken" }>,
): State {
  const { pager, plates } = event;
  if (!isPagerNumber(pager)) {
    throw new Error(`Pager ${String(pager)} does not exist`);
  }
  if (isAttached(state, pager)) {
    throw new Error(`Pager ${String(pager)} is attached to an open order`);
  }
  checkPlates(plates);
  const order: Order = {
    id: event.id,
    pager,
    seq: event.seq,
    takenAt: event.at,
    lines: MENU.flatMap(({ id }) => {
      const plate = plates.find((p) => p.productId === id);
      return plate === undefined ? [] : [newLine(id, plate.count)];
    }),
  };
  return {
    ...state,
    orders: [...state.orders, order],
    missingPagers: state.missingPagers.filter((p) => p !== pager),
  };
}

function buzzPlates(
  state: State,
  event: Extract<Event, { type: "platesBuzzed" }>,
): State {
  const order = openOrder(state, event.orderId);
  const line = lineOf(order, event.productId);
  checkCount(event.count, waitingOf(line));
  return replaceLine(state, order, buzz(line, event.count, event.at));
}

function handOn(
  state: State,
  event: Extract<Event, { type: "plateHandedOn" }>,
): State {
  const giver = openOrder(state, event.fromOrderId);
  const giverLine = buzzedLineOf(giver, event.productId);
  if (event.toOrderId === giver.id) {
    throw new Error("A plate cannot be handed on to its own order");
  }
  const receiver = openOrder(state, event.toOrderId);
  const receiverLine = lineOf(receiver, event.productId);
  checkCount(1, waitingOf(receiverLine));
  return replaceLine(
    replaceLine(state, giver, unbuzz(giverLine, {})),
    receiver,
    buzz(receiverLine, 1, event.at),
  );
}

function sendBackToQueue(
  state: State,
  event: Extract<Event, { type: "plateSentBackToQueue" }>,
): State {
  const order = openOrder(state, event.orderId);
  const line = buzzedLineOf(order, event.productId);
  return replaceLine(
    state,
    order,
    unbuzz(line, { backToQueue: line.backToQueue + 1 }),
  );
}

function rebuzz(
  state: State,
  event: Extract<Event, { type: "rebuzzed" }>,
): State {
  const order = openOrder(state, event.orderId);
  const line = buzzedLineOf(order, event.productId);
  return replaceLine(state, order, { ...line, buzzClockFrom: event.at });
}

function handOver(
  state: State,
  event: Extract<Event, { type: "platesHandedOver" }>,
): State {
  const order = openOrder(state, event.orderId);
  checkPlates(event.plates);
  for (const { productId } of event.plates) {
    lineOf(order, productId);
  }
  const lines = order.lines.map((line) => {
    const plate = event.plates.find((p) => p.productId === line.productId);
    if (plate === undefined) {
      return line;
    }
    checkCount(plate.count, line.buzzed + waitingOf(line));
    // Buzzed plates go first; any rest comes from the waiting ones.
    const fromBuzzed = Math.min(plate.count, line.buzzed);
    const handed: Line = {
      ...line,
      pickedUp: line.pickedUp + plate.count,
      pickedUpWaitingTimeMs:
        line.pickedUpWaitingTimeMs +
        plate.count * waitingTimeMs(order, event.at),
    };
    return fromBuzzed === line.buzzed
      ? withoutClock({ ...handed, buzzed: 0 })
      : { ...handed, buzzed: line.buzzed - fromBuzzed };
  });
  return closeIfEmpty(state, { ...order, lines }, "handover", event.at);
}

function cancelPlates(
  state: State,
  event: Extract<Event, { type: "platesCancelled" }>,
): State {
  const order = openOrder(state, event.orderId);
  const line = lineOf(order, event.productId);
  // Buzzed plates are on the counter: they are handed on or sent back, never cancelled.
  checkCount(event.count, waitingOf(line));
  const cancelled = { ...line, cancelled: line.cancelled + event.count };
  return closeIfEmpty(state, withLine(order, cancelled), "cancel", event.at);
}

function abandonOrder(
  state: State,
  event: Extract<Event, { type: "orderAbandoned" }>,
): State {
  const order = openOrder(state, event.orderId);
  const closed: Order = {
    ...order,
    closedAt: event.at,
    closedBy: "abandoned",
    lines: order.lines.map((line) =>
      withoutClock({
        ...line,
        cancelled: line.cancelled + waitingOf(line),
        abandoned: line.abandoned + line.buzzed,
        buzzed: 0,
      }),
    ),
  };
  const next = replaceOrder(state, closed);
  return event.pagerBack
    ? next
    : {
        ...next,
        missingPagers: [...next.missingPagers, order.pager].sort(
          (a, b) => a - b,
        ),
      };
}

function markPagerMissing(state: State, pager: number): State {
  if (!isPagerNumber(pager) || isAttached(state, pager)) {
    throw new Error(`Pager ${String(pager)} is not free`);
  }
  if (state.missingPagers.includes(pager)) {
    throw new Error(`Pager ${String(pager)} is already missing`);
  }
  return {
    ...state,
    missingPagers: [...state.missingPagers, pager].sort((a, b) => a - b),
  };
}

function restorePager(state: State, pager: number): State {
  if (!state.missingPagers.includes(pager)) {
    throw new Error(`Pager ${String(pager)} is not missing`);
  }
  return {
    ...state,
    missingPagers: state.missingPagers.filter((p) => p !== pager),
  };
}

function markSoldOut(state: State, productId: string, at: number): State {
  checkProduct(productId);
  if (state.soldOut.includes(productId)) {
    throw new Error(`${productId} is already sold out`);
  }
  return {
    ...state,
    soldOut: MENU.map(({ id }) => id).filter(
      (id) => id === productId || state.soldOut.includes(id),
    ),
    soldOutFirstAt:
      productId in state.soldOutFirstAt
        ? state.soldOutFirstAt
        : { ...state.soldOutFirstAt, [productId]: at },
  };
}

function clearSoldOut(state: State, productId: string): State {
  if (!state.soldOut.includes(productId)) {
    throw new Error(`${productId} is not sold out`);
  }
  return {
    ...state,
    soldOut: state.soldOut.filter((id) => id !== productId),
  };
}

// An order with no open plates closes, and frees its pager, in the event that emptied it; there is
// no separate pager-return event (spec, "Core state").
function closeIfEmpty(
  state: State,
  order: Order,
  closedBy: ClosedBy,
  at: number,
): State {
  const empty = order.lines.every(
    (line) => line.buzzed + waitingOf(line) === 0,
  );
  return replaceOrder(
    state,
    empty ? { ...order, closedAt: at, closedBy } : order,
  );
}

/** Plates still to buzz on a line. */
export function waitingOf(line: Line): number {
  return (
    line.ordered - line.cancelled - line.buzzed - line.pickedUp - line.abandoned
  );
}

/** From intake to `at`; never below 0, since another iPad's clock may be behind in sync mode. */
export function waitingTimeMs(order: Order, at: number): number {
  return Math.max(0, at - order.takenAt);
}

export function isOpen(order: Order): boolean {
  return order.closedBy === undefined;
}

function newLine(productId: string, ordered: number): Line {
  return {
    productId,
    ordered,
    cancelled: 0,
    buzzed: 0,
    pickedUp: 0,
    pickedUpWaitingTimeMs: 0,
    backToQueue: 0,
    abandoned: 0,
  };
}

// A further buzz on a line that already has buzzed plates keeps its clock (spec, "Core state").
function buzz(line: Line, count: number, at: number): Line {
  return {
    ...line,
    buzzed: line.buzzed + count,
    buzzClockFrom: line.buzzed === 0 ? at : (line.buzzClockFrom ?? at),
  };
}

// Takes one buzzed plate off the line; its clock clears once nothing is buzzed.
function unbuzz(line: Line, change: Partial<Line>): Line {
  const next = { ...line, ...change, buzzed: line.buzzed - 1 };
  return next.buzzed === 0 ? withoutClock(next) : next;
}

function withoutClock(line: Line): Line {
  const { buzzClockFrom, ...rest } = line;
  return rest;
}

function withLine(order: Order, line: Line): Order {
  return {
    ...order,
    lines: order.lines.map((l) => (l.productId === line.productId ? line : l)),
  };
}

function replaceLine(state: State, order: Order, line: Line): State {
  return replaceOrder(state, withLine(order, line));
}

function replaceOrder(state: State, order: Order): State {
  return {
    ...state,
    orders: state.orders.map((o) => (o.id === order.id ? order : o)),
  };
}

function openOrder(state: State, orderId: string): Order {
  const order = state.orders.find((o) => o.id === orderId);
  if (order === undefined) {
    throw new Error(`No order ${orderId}`);
  }
  if (!isOpen(order)) {
    throw new Error(`Order ${orderId} is closed`);
  }
  return order;
}

function lineOf(order: Order, productId: string): Line {
  const line = order.lines.find((l) => l.productId === productId);
  if (line === undefined) {
    throw new Error(`Order ${order.id} has no ${productId}`);
  }
  return line;
}

function buzzedLineOf(order: Order, productId: string): Line {
  const line = lineOf(order, productId);
  if (line.buzzed === 0) {
    throw new Error(`Nothing of ${productId} is buzzed on ${order.id}`);
  }
  return line;
}

function checkPlates(plates: readonly PlateCount[]): void {
  if (plates.length === 0) {
    throw new Error("No plates");
  }
  const seen = new Set<string>();
  for (const { productId, count } of plates) {
    checkProduct(productId);
    if (seen.has(productId)) {
      throw new Error(`${productId} is listed twice`);
    }
    seen.add(productId);
    checkCount(count, Number.POSITIVE_INFINITY);
  }
}

function checkProduct(productId: string): void {
  if (!MENU.some(({ id }) => id === productId)) {
    throw new Error(`Unknown product ${productId}`);
  }
}

function checkCount(count: number, max: number): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`Count ${String(count)} is not a positive integer`);
  }
  if (count > max) {
    throw new Error(`Count ${String(count)} is more than ${String(max)}`);
  }
}

function isAttached(state: State, pager: number): boolean {
  return state.orders.some((order) => isOpen(order) && order.pager === pager);
}

function isPagerNumber(pager: number): boolean {
  return Number.isInteger(pager) && pager >= 1 && pager <= PAGER_COUNT;
}
