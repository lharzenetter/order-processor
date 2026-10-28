import {
  acceptsIntake,
  boardRows,
  buzzedLines,
  fold,
  handOnTarget,
  labelOf,
  nextOrderFor,
  openOrderByPager,
  openOrdersList,
  orderView,
  pagerCheck,
  pagerOverview,
  soldOutWaiting,
  undoTarget,
} from "../src/core";
import type {
  Event,
  EventBody,
  Order,
  OrderViewLine,
  PlateCount,
  ProductId,
  State,
} from "../src/core";
import { expectComparisonCell, expectEvaluationRow } from "./figures";
import { clockOf, movingTo, msOf, passing, START_AT } from "./kirbe-calendar";
import type {
  BuzzedLineRef,
  BuzzedLineSeen,
  Duration,
  LineSeen,
  OpenOrderSeen,
  Plates,
  SoldOutOrderSeen,
  Steps,
  Window,
} from "./window";

/** How the intake grid and the header show a pager. */
type PagerState = "with the guest" | "free" | "missing";

/** A line of the buzzed list as staff read it. */
interface BuzzedRow {
  readonly pager: number;
  readonly product: ProductId;
  readonly plates: number;
  readonly sinceMs: number;
  readonly rebuzzDue: boolean;
}

/** What an exact `lists` observation compares: every item, in order, and nothing else. */
interface Listing<Shown, Wanted> {
  /** "the buzzed list", as the failure names it. */
  readonly list: string;
  readonly shown: readonly Shown[];
  readonly wanted: readonly Wanted[];
  readonly matches: (shown: Shown, want: Wanted) => boolean;
  readonly describeShown: (shown: readonly Shown[]) => string;
  readonly describeWanted: (wanted: readonly Wanted[]) => string;
}

function expectListed<Shown, Wanted>({
  list,
  shown,
  wanted,
  matches,
  describeShown,
  describeWanted,
}: Listing<Shown, Wanted>): Promise<void> {
  const same =
    shown.length === wanted.length &&
    wanted.every((want, i) => {
      const item = shown[i];
      return item !== undefined && matches(item, want);
    });
  if (!same) {
    throw new Error(
      `expected ${list} to list ${describeWanted(wanted)}, but it lists ${describeShown(shown)}`,
    );
  }
  return Promise.resolve();
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

  function lineOf(pager: number, product: string): OrderViewLine | undefined {
    return linesOf(pager).find((l) => l.productId === product);
  }

  function pagerState(pager: number): PagerState {
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

  function rowsText(rows: readonly BuzzedRow[]): string {
    return rows.map(describeRow).join(", ") || "nothing";
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

  function rowMatches(row: BuzzedRow, want: BuzzedLineSeen): boolean {
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
    return lineOf(pager, product)?.buzzed ?? 0;
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
    return lineOf(pager, product)?.waiting ?? 0;
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

  function openOrdersText(orders: readonly OpenOrderSeen[]): string {
    return orders.map(describeOpenOrder).join("; ") || "nothing";
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
    return (
      toPlateCounts(plates).find(({ productId, count }) => {
        const line = lineOf(pager, productId);
        return count > (line === undefined ? 0 : line.buzzed + line.waiting);
      }) ?? null
    );
  }

  /** The line's "Wartezeit" or "Abholzeit" in the order popup, as "m:ss". */
  function expectLineTime(
    pager: number,
    product: ProductId,
    which: "Wartezeit" | "Abholzeit",
    want: Duration,
  ): Promise<void> {
    const line = lineOf(pager, product);
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
          showsWaitingTime(product, waitingTime) {
            return expectLineTime(pager, product, "Wartezeit", waitingTime);
          },
          showsPickupTime(product, pickupTime) {
            return expectLineTime(pager, product, "Abholzeit", pickupTime);
          },
        };
      },
      pager(pager) {
        function expectState(want: PagerState): Promise<void> {
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
            return expectListed({
              list: "the buzzed list",
              shown: buzzedListRows(),
              wanted: lines,
              matches: rowMatches,
              describeShown: rowsText,
              describeWanted: (wanted) =>
                wanted.map(describeBuzzed).join(", ") || "nothing",
            });
          },
          includes(line) {
            const rows = buzzedListRows();
            if (!rows.some((row) => rowMatches(row, line))) {
              throw new Error(
                `expected the buzzed list to include ${describeBuzzed(line)}, but it lists ${rowsText(rows)}`,
              );
            }
            return Promise.resolve();
          },
          isEmpty() {
            const rows = buzzedListRows();
            if (rows.length > 0) {
              throw new Error(
                `expected the buzzed list to be empty, but it lists ${rowsText(rows)}`,
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
            return expectListed({
              list: `the ${label} sold-out banner`,
              shown: soldOutOrders(product),
              wanted: orders,
              matches: (chip, want) =>
                chip.pager === want.pager &&
                (want.plates === undefined || chip.plates === want.plates),
              describeShown: chipsText,
              describeWanted: chipsText,
            });
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
            return expectListed({
              list: "the Offene Bestellungen list",
              shown: openOrdersRows(),
              wanted: orders,
              matches: sameOpenOrder,
              describeShown: openOrdersText,
              describeWanted: openOrdersText,
            });
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
        return {
          row(product) {
            return {
              has(want) {
                expectEvaluationRow(state, product, shift, want);
                return Promise.resolve();
              },
            };
          },
        };
      },
      comparison(column) {
        return {
          row(product) {
            return {
              has(want) {
                expectComparisonCell(state, column, product, want);
                return Promise.resolve();
              },
            };
          },
          total() {
            return {
              has(want) {
                expectComparisonCell(state, column, "total", want);
                return Promise.resolve();
              },
            };
          },
        };
      },
    },
    time: {
      passes(duration) {
        now = passing(now, duration);
        return Promise.resolve();
      },
      isNow(dayAndTime) {
        now = movingTo(now, dayAndTime);
        return Promise.resolve();
      },
    },
  };
}
