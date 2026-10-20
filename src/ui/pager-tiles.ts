import { PAGER_COUNT } from "../core/index";
import type { PagerOverview } from "../core/index";

export type PagerTileStatus = "free" | "attached" | "missing" | "selected";

export interface PagerTile {
  readonly pager: number;
  readonly status: PagerTileStatus;
  /** Still true once a missing pager is selected: the missing-pager mode restores it on a tap. */
  readonly missing: boolean;
  /** The accessible name; the state is in it so a screen reader and the smoke flows can tell. */
  readonly name: string;
}

/** The intake's fixed grid: every pager in its own place, whatever its state. */
export function pagerTiles(
  overview: PagerOverview,
  selected: number | null,
): readonly PagerTile[] {
  return Array.from({ length: PAGER_COUNT }, (_, i) => {
    const pager = i + 1;
    const name = `Pager ${String(pager)}`;
    if (overview.attached.includes(pager)) {
      return {
        pager,
        status: "attached",
        missing: false,
        name: `${name}, beim Gast`,
      };
    }
    const missing = overview.missing.includes(pager);
    return {
      pager,
      status: pager === selected ? "selected" : missing ? "missing" : "free",
      missing,
      name: missing ? `${name}, fehlt` : name,
    };
  });
}
