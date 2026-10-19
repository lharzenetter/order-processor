import { describe, expect, it } from "vitest";
import {
  acceptsIntake,
  fold,
  headerCounts,
  PAGER_COUNT,
  pagerCheck,
  pagerOverview,
} from "./index";
import type { EventBody } from "./index";
import { testLog } from "./test-log";

function foldBodies(...bodies: readonly EventBody[]) {
  const log = testLog();
  for (const body of bodies) {
    log.add(body);
  }
  return fold(log.events);
}

const POMMES = [{ productId: "pommes", count: 1 }];

describe("pagers", () => {
  it("are all free at the start", () => {
    const overview = pagerOverview(foldBodies());
    expect(overview.free).toHaveLength(PAGER_COUNT);
    expect(overview.free[0]).toBe(1);
    expect(overview.free.at(-1)).toBe(30);
    expect(overview.allOut).toBe(false);
  });

  it("are attached while an open order holds them", () => {
    const state = foldBodies({ type: "orderTaken", pager: 4, plates: POMMES });
    expect(pagerOverview(state)).toMatchObject({ attached: [4], missing: [] });
    expect(pagerOverview(state).free).not.toContain(4);
    expect(headerCounts(state)).toEqual({ openOrders: 1, freePagers: 29 });
  });

  it("are all out when every pager is attached or missing", () => {
    const bodies: EventBody[] = [{ type: "pagerMarkedMissing", pager: 30 }];
    for (let pager = 1; pager < 30; pager++) {
      bodies.push({ type: "orderTaken", pager, plates: POMMES });
    }
    const overview = pagerOverview(foldBodies(...bodies));
    expect(overview.free).toEqual([]);
    expect(overview.allOut).toBe(true);
  });

  it("can be marked missing and restored", () => {
    const missing = foldBodies(
      { type: "pagerMarkedMissing", pager: 23 },
      { type: "pagerMarkedMissing", pager: 2 },
    );
    expect(pagerOverview(missing).missing).toEqual([2, 23]);
    expect(pagerOverview(missing).free).not.toContain(23);
    const restored = foldBodies(
      { type: "pagerMarkedMissing", pager: 23 },
      { type: "pagerRestored", pager: 23 },
    );
    expect(pagerOverview(restored).missing).toEqual([]);
  });

  // 05-exceptions: a pager that turned up again is restored when an order is started on it
  it("are restored when an order is taken on a missing one", () => {
    const state = foldBodies(
      { type: "pagerMarkedMissing", pager: 23 },
      { type: "orderTaken", pager: 23, plates: POMMES },
    );
    expect(pagerOverview(state)).toMatchObject({ missing: [], attached: [23] });
  });

  it.each<[string, readonly EventBody[]]>([
    ["an order on pager 0", [{ type: "orderTaken", pager: 0, plates: POMMES }]],
    [
      "an order on pager 31",
      [{ type: "orderTaken", pager: 31, plates: POMMES }],
    ],
    [
      "an order on an attached pager",
      [
        { type: "orderTaken", pager: 4, plates: POMMES },
        { type: "orderTaken", pager: 4, plates: POMMES },
      ],
    ],
    ["an order without plates", [{ type: "orderTaken", pager: 4, plates: [] }]],
    [
      "an order with a zero count",
      [
        {
          type: "orderTaken",
          pager: 4,
          plates: [{ productId: "pommes", count: 0 }],
        },
      ],
    ],
    [
      "an order with an unknown product",
      [
        {
          type: "orderTaken",
          pager: 4,
          plates: [{ productId: "bier", count: 1 }],
        },
      ],
    ],
    [
      "marking an attached pager missing",
      [
        { type: "orderTaken", pager: 4, plates: POMMES },
        { type: "pagerMarkedMissing", pager: 4 },
      ],
    ],
    [
      "marking a missing pager missing",
      [
        { type: "pagerMarkedMissing", pager: 4 },
        { type: "pagerMarkedMissing", pager: 4 },
      ],
    ],
    [
      "restoring a pager that is not missing",
      [{ type: "pagerRestored", pager: 4 }],
    ],
  ])("refuse %s", (_, bodies) => {
    expect(() => foldBodies(...bodies)).toThrow();
  });
});

// 05-exceptions: an attached pager is rejected, a missing one warns and is restored
describe("checking the pager typed at intake", () => {
  const state = foldBodies(
    { type: "orderTaken", pager: 4, plates: POMMES },
    { type: "pagerMarkedMissing", pager: 23 },
  );

  it.each<[number | null, string]>([
    [null, "empty"],
    [0, "outOfRange"],
    [31, "outOfRange"],
    [4, "attached"],
    [23, "missing"],
    [5, "free"],
  ])("classifies pager %s as %s", (pager, verdict) => {
    expect(pagerCheck(state, pager)).toBe(verdict);
  });

  it("lets intake start an order only on a free or a missing pager", () => {
    expect(
      [5, 23, 4, 0, null].map((p) => acceptsIntake(pagerCheck(state, p))),
    ).toEqual([true, true, false, false, false]);
  });
});
