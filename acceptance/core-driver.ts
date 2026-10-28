import {
  acceptsIntake,
  buzzedLines,
  fold,
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
import type { BuzzedLineSeen, LineSeen, Plates, Window } from "./window";

// PROTOTYPE (#12). Samstag 10:00 waits for the time area; any fixed instant will do here.
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
    return `pager ${String(line.pager)} ${labelOf(line.product)}${plates}`;
  }

  function buzzedListRows(): readonly Required<BuzzedLineSeen>[] {
    return buzzedLines(state, now).map((l) => ({
      pager: l.pager,
      // The selector widens ids to string; a scenario only compares them.
      product: l.productId as ProductId,
      plates: l.buzzed,
    }));
  }

  function matches(row: BuzzedLineSeen, want: BuzzedLineSeen): boolean {
    return (
      row.pager === want.pager &&
      row.product === want.product &&
      (want.plates === undefined || row.plates === want.plates)
    );
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
                `expected the buzzed list to list ${lines.map(describeBuzzed).join(", ") || "nothing"}, but it lists ${rows.map(describeBuzzed).join(", ") || "nothing"}`,
              );
            }
            return Promise.resolve();
          },
          includes(line) {
            if (!buzzedListRows().some((row) => matches(row, line))) {
              throw new Error(
                `expected the buzzed list to include ${describeBuzzed(line)}, but it does not`,
              );
            }
            return Promise.resolve();
          },
          isEmpty() {
            const rows = buzzedListRows();
            if (rows.length > 0) {
              throw new Error(
                `expected the buzzed list to be empty, but it lists ${rows.map(describeBuzzed).join(", ")}`,
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
      passes({ minutes = 0, seconds = 0 }) {
        now += (minutes * 60 + seconds) * 1000;
        return Promise.resolve();
      },
    },
  };
}
