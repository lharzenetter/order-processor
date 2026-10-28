import { describe, expect, it } from "vitest";
import { fold } from "./index";
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
