import { describe, expect, it } from "vitest";
import type { PagerOverview } from "../core/index";
import { pagerTiles } from "./pager-tiles";

// Pager 3 hangs on an open order, pager 11 is missing, the rest are free.
const OVERVIEW: PagerOverview = {
  free: Array.from({ length: 30 }, (_, i) => i + 1).filter(
    (pager) => pager !== 3 && pager !== 11,
  ),
  attached: [3],
  missing: [11],
  allOut: false,
};

describe("the intake pager grid", () => {
  it("shows all 30 pagers in number order", () => {
    expect(pagerTiles(OVERVIEW, null).map((t) => t.pager)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it("names each pager by its state", () => {
    const tiles = pagerTiles(OVERVIEW, 8);
    expect(tiles[0]).toEqual({
      pager: 1,
      status: "free",
      missing: false,
      name: "Pager 1",
    });
    expect(tiles[2]).toEqual({
      pager: 3,
      status: "attached",
      missing: false,
      name: "Pager 3, beim Gast",
    });
    expect(tiles[10]).toEqual({
      pager: 11,
      status: "missing",
      missing: true,
      name: "Pager 11, fehlt",
    });
    expect(tiles[7]).toEqual({
      pager: 8,
      status: "selected",
      missing: false,
      name: "Pager 8",
    });
  });

  it("shows a missing pager as chosen once tapped, since the order restores it", () => {
    // 05-exceptions
    expect(pagerTiles(OVERVIEW, 11)[10]).toEqual({
      pager: 11,
      status: "selected",
      missing: true,
      name: "Pager 11, fehlt",
    });
  });
});
