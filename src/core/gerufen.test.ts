import { describe, expect, it } from "vitest";
import { buzzedLines, fold, REBUZZ_AFTER_MS } from "./index";
import { testLog } from "./test-log";

function twoBratenOn12() {
  const log = testLog();
  const order = log.add({
    type: "orderTaken",
    pager: 12,
    plates: [
      { productId: "braten", count: 2 },
      { productId: "pommes", count: 1 },
    ],
  });
  return { log, order };
}

describe("the Gerufen column", () => {
  it("lists every buzzed line with the time since its buzz", () => {
    const { log, order } = twoBratenOn12();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    log.wait(40_000);
    expect(buzzedLines(fold(log.events), log.now)).toEqual([
      {
        orderId: order.id,
        pager: 12,
        productId: "braten",
        label: "Braten",
        buzzed: 1,
        sinceBuzzMs: 40_000,
        rebuzzDue: false,
      },
    ]);
  });

  it("lists the oldest buzz first", () => {
    const { log, order } = twoBratenOn12();
    const other = log.add({
      type: "orderTaken",
      pager: 3,
      plates: [{ productId: "schaeufele", count: 1 }],
    });
    log.add({
      type: "platesBuzzed",
      orderId: other.id,
      productId: "schaeufele",
      count: 1,
    });
    log.wait(1_000);
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "pommes",
      count: 1,
    });
    log.wait(1_000);
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 2,
    });
    expect(
      buzzedLines(fold(log.events), log.now).map((l) => [
        l.pager,
        l.productId,
        l.buzzed,
      ]),
    ).toEqual([
      [3, "schaeufele", 1],
      [12, "pommes", 1],
      [12, "braten", 2],
    ]);
  });

  // 04-allocation-and-handover-rules: re-buzz highlight after 3 min
  it("makes a re-buzz due once a line has waited 3 minutes since its buzz", () => {
    const { log, order } = twoBratenOn12();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    log.wait(REBUZZ_AFTER_MS - 1);
    expect(buzzedLines(fold(log.events), log.now)[0]?.rebuzzDue).toBe(false);
    log.wait(1);
    expect(buzzedLines(fold(log.events), log.now)[0]?.rebuzzDue).toBe(true);
  });

  it("restarts the line's clock on Nochmal rufen", () => {
    const { log, order } = twoBratenOn12();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    log.wait(REBUZZ_AFTER_MS);
    log.add({ type: "rebuzzed", orderId: order.id, productId: "braten" });
    log.wait(5_000);
    expect(buzzedLines(fold(log.events), log.now)[0]).toMatchObject({
      sinceBuzzMs: 5_000,
      rebuzzDue: false,
    });
  });

  it("keeps the clock when a line that already has buzzed plates is buzzed again", () => {
    const { log, order } = twoBratenOn12();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    log.wait(REBUZZ_AFTER_MS);
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 1,
    });
    expect(buzzedLines(fold(log.events), log.now)[0]).toMatchObject({
      buzzed: 2,
      sinceBuzzMs: REBUZZ_AFTER_MS,
      rebuzzDue: true,
    });
  });

  it("refuses to buzz more plates than are waiting", () => {
    const { log, order } = twoBratenOn12();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "braten",
      count: 3,
    });
    expect(() => fold(log.events)).toThrow();
  });

  it("refuses to buzz a product the order does not have", () => {
    const { log, order } = twoBratenOn12();
    log.add({
      type: "platesBuzzed",
      orderId: order.id,
      productId: "maultaschen",
      count: 1,
    });
    expect(() => fold(log.events)).toThrow();
  });

  it("refuses a re-buzz on a line with nothing buzzed", () => {
    const { log, order } = twoBratenOn12();
    log.add({ type: "rebuzzed", orderId: order.id, productId: "braten" });
    expect(() => fold(log.events)).toThrow();
  });
});
