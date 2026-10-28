import {
  acceptsIntake,
  boardRows,
  buzzedLines,
  fold,
  handOnTarget,
  labelOf,
  nextOrderFor,
  openOrderByPager,
  orderView,
  pagerCheck,
  pagerOverview,
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
import type {
  BuzzedLineRef,
  BuzzedLineSeen,
  Duration,
  LineSeen,
  Plates,
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

// Samstag 10:00 comes with the evaluation scenarios (#20); until then any fixed instant will do.
const START_AT = 1_760_000_000_000;

/** Runs a scenario on `fold` and the selectors: the same reads the UI makes (#7). */
export function coreWindow(): Window {
  const events: Event[] = [];
  let state: State = fold([]);
  let now = START_AT;

  function append(body: EventBody): void {
    const seq = events.length + 1;
    const next = [...events, { ...body, id: `e${String(seq)}`, seq, at: now }];
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

  function boardRow(product: ProductId) {
    const row = boardRows(state).find((r) => r.productId === product);
    if (row === undefined) {
      throw new Error(`the board has no row for ${labelOf(product)}`);
    }
    return row;
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

  return {
    staff: {
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
          const waiting =
            linesOf(pager).find((l) => l.productId === product)?.waiting ?? 0;
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
        return {
          refusesPager: (pager) => check(pager, false),
          acceptsPager: (pager) => check(pager, true),
        };
      },
    },
    time: {
      passes(duration) {
        now += msOf(duration);
        return Promise.resolve();
      },
    },
  };
}
