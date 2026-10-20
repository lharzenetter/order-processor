import { useState } from "react";
import {
  acceptsIntake,
  labelOf,
  MENU,
  pagerCheck,
  pagerOverview,
} from "../core/index";
import type { PlateCount, State } from "../core/index";
import { cx } from "./cx";
import styles from "./IntakeDialog.module.css";
import { ModalDialog } from "./ModalDialog";
import { pagerTiles } from "./pager-tiles";
import type { PagerTile, PagerTileStatus } from "./pager-tiles";
import shared from "./shared.module.css";
import { SoldOutTag } from "./SoldOutTag";
import { StepHeading } from "./StepHeading";

const TILE_SUBLINE: Readonly<Record<PagerTileStatus, string>> = {
  free: "",
  attached: "beim Gast",
  missing: "fehlt",
  selected: "gewählt",
};

/**
 * Neue Bestellung: A the dishes from the Bon, then B the pager. It always opens empty: closing it
 * throws the draft away (decided in "Window screen prototype").
 */
export function IntakeDialog({
  state,
  onClose,
  onTakeOrder,
  onMarkMissing,
  onRestore,
}: {
  state: State;
  onClose: () => void;
  onTakeOrder: (pager: number, plates: readonly PlateCount[]) => void;
  onMarkMissing: (pager: number) => void;
  onRestore: (pager: number) => void;
}) {
  const [draft, setDraft] = useState<Readonly<Record<string, number>>>({});
  const [pager, setPager] = useState<number | null>(null);
  const [missingMode, setMissingMode] = useState(false);
  const [confirmSoldOut, setConfirmSoldOut] = useState<string | null>(null);

  const overview = pagerOverview(state);
  const check = pagerCheck(state, pager);
  const plates = MENU.flatMap(({ id }) => {
    const count = draft[id] ?? 0;
    return count > 0 ? [{ productId: id, count }] : [];
  });
  const plateTotal = plates.reduce((total, p) => total + p.count, 0);
  const canStart = pager !== null && plateTotal > 0 && acceptsIntake(check);

  function add(productId: string): void {
    setDraft((current) => ({
      ...current,
      [productId]: (current[productId] ?? 0) + 1,
    }));
  }

  function tapProduct(productId: string): void {
    if (state.soldOut.includes(productId) && (draft[productId] ?? 0) === 0) {
      setConfirmSoldOut(productId);
      return;
    }
    add(productId);
  }

  function tapPager(tile: PagerTile): void {
    if (!missingMode) {
      setPager(tile.pager);
    } else if (tile.missing) {
      onRestore(tile.pager);
    } else {
      onMarkMissing(tile.pager);
    }
  }

  function tileName(tile: PagerTile): string {
    if (!missingMode) {
      return tile.name;
    }
    const pagerName = `Pager ${String(tile.pager)}`;
    return tile.missing
      ? `${pagerName} wieder freigeben`
      : `${pagerName} als fehlend markieren`;
  }

  const soldOutLabel =
    confirmSoldOut === null ? undefined : labelOf(confirmSoldOut);

  return (
    <ModalDialog title="Neue Bestellung" size="wide" onClose={onClose}>
      <div className={styles.columns}>
        <section className={styles.dishes}>
          <StepHeading
            level={3}
            step="A"
            title="Bon abtippen"
            hint="ein Tipp = ein Teller"
          />
          <div className={styles.products}>
            {MENU.map(({ id, label }) => {
              const count = draft[id] ?? 0;
              const soldOut = state.soldOut.includes(id);
              return (
                <div
                  key={id}
                  className={cx(styles.product, count > 0 && styles.counted)}
                >
                  <button
                    type="button"
                    className={styles.productButton}
                    aria-label={`${label}${count > 0 ? `, ${String(count)} Teller` : ""}`}
                    onClick={() => {
                      tapProduct(id);
                    }}
                  >
                    {label}
                    {soldOut && <SoldOutTag />}
                  </button>
                  {count > 0 && (
                    <>
                      <span className={styles.count}>{count}</span>
                      <button
                        type="button"
                        className={styles.minus}
                        aria-label={`Einen Teller ${label} weniger`}
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            [id]: Math.max(0, (current[id] ?? 0) - 1),
                          }));
                        }}
                      >
                        −
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className={styles.pagers}>
          <div className={shared.row}>
            <span className={shared.grow}>
              <StepHeading level={3} step="B" title="Pager antippen" />
            </span>
            <button
              type="button"
              className={cx(missingMode && shared.secondary)}
              aria-pressed={missingMode}
              onClick={() => {
                setMissingMode((on) => !on);
              }}
            >
              {missingMode ? "Fertig" : "Pager fehlt…"}
            </button>
          </div>
          <p className={styles.hint} role="note">
            {missingMode
              ? "Freien Pager antippen: fehlt. Gestrichelten antippen: wieder da."
              : check === "missing" && pager !== null
                ? `Pager ${String(pager)} ist als fehlend markiert — mit „Bestellung anlegen“ wird er wieder freigegeben`
                : ""}
          </p>
          {/* A fixed 6 × 5 grid: every pager number always sits in the same place. */}
          <div className={styles.grid} role="group" aria-label="Pager">
            {pagerTiles(overview, pager).map((tile) => (
              <button
                key={tile.pager}
                type="button"
                className={cx(styles.tile, styles[tile.status])}
                disabled={tile.status === "attached"}
                aria-pressed={tile.status === "selected"}
                aria-label={tileName(tile)}
                onClick={() => {
                  tapPager(tile);
                }}
              >
                {tile.pager}
                <small>{TILE_SUBLINE[tile.status]}</small>
              </button>
            ))}
          </div>
          <p className={cx(shared.muted, styles.legend)}>
            <span>Weiß = frei</span>
            <span>Grau = beim Gast</span>
            <span>Gestrichelt = fehlt</span>
            <span>Dunkel = gewählt</span>
          </p>
        </section>
      </div>
      <div className={cx(shared.row, styles.footer)}>
        <button type="button" className={styles.cancel} onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className={cx(shared.primary, shared.grow, styles.create)}
          disabled={!canStart}
          onClick={() => {
            if (pager !== null) {
              onTakeOrder(pager, plates);
            }
          }}
        >
          Bestellung anlegen
          {plateTotal > 0 && ` · ${String(plateTotal)} Teller`}
          {pager !== null &&
            acceptsIntake(check) &&
            ` · Pager ${String(pager)}`}
        </button>
      </div>
      {confirmSoldOut !== null && soldOutLabel !== undefined && (
        <ModalDialog
          title={`${soldOutLabel} ist ausverkauft`}
          onClose={() => {
            setConfirmSoldOut(null);
          }}
        >
          <p className={shared.muted}>
            Der Gast hat schon bezahlt. Trotzdem eintragen?
          </p>
          <div className={styles.stack}>
            <button
              type="button"
              className={shared.primary}
              onClick={() => {
                add(confirmSoldOut);
                setConfirmSoldOut(null);
              }}
            >
              {soldOutLabel} trotzdem eintragen
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmSoldOut(null);
              }}
            >
              Weglassen
            </button>
          </div>
        </ModalDialog>
      )}
    </ModalDialog>
  );
}
