import { useState } from "react";
import {
  acceptsIntake,
  labelOf,
  MENU,
  pagerCheck,
  pagerOverview,
  PAGER_COUNT,
} from "../core/index";
import type { PagerCheck, PlateCount, State } from "../core/index";
import { cx } from "./cx";
import styles from "./IntakeDialog.module.css";
import { Keypad, PagerDisplay, pressKey } from "./Keypad";
import { ModalDialog } from "./ModalDialog";
import shared from "./shared.module.css";

const HINTS: Readonly<Record<PagerCheck, (pager: string) => string>> = {
  empty: () => "Pager-Nummer eintippen oder antippen",
  outOfRange: () => `Pager gibt es von 1 bis ${String(PAGER_COUNT)}`,
  attached: (pager) => `Pager ${pager} hängt noch an einer offenen Bestellung`,
  missing: (pager) =>
    `Pager ${pager} ist als fehlend markiert — mit „Bestellung anlegen“ wird er wieder freigegeben`,
  free: () => "",
};

/**
 * Neue Bestellung: the dishes from the Bon, then the pager. It always opens empty: closing it
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
  const [digits, setDigits] = useState("");
  const [missingMode, setMissingMode] = useState(false);
  const [confirmSoldOut, setConfirmSoldOut] = useState<string | null>(null);

  const pager = digits === "" ? null : Number(digits);
  const check = pagerCheck(state, pager);
  const bad = check === "attached" || check === "outOfRange";
  const plates = MENU.flatMap(({ id }) => {
    const count = draft[id] ?? 0;
    return count > 0 ? [{ productId: id, count }] : [];
  });
  const plateTotal = plates.reduce((total, p) => total + p.count, 0);
  const canStart =
    pager !== null &&
    plateTotal > 0 &&
    (check === "free" || check === "missing");
  const { free, missing } = pagerOverview(state);

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

  const soldOutLabel =
    confirmSoldOut === null ? undefined : labelOf(confirmSoldOut);

  return (
    <ModalDialog title="Neue Bestellung" size="wide" onClose={onClose}>
      <div className={styles.columns}>
        <div>
          <h3 className={shared.heading}>Bon — jeden Teller antippen</h3>
          <div className={styles.products}>
            {MENU.map(({ id, label }) => {
              const count = draft[id] ?? 0;
              const soldOut = state.soldOut.includes(id);
              return (
                <div
                  key={id}
                  className={cx(styles.product, soldOut && styles.sold)}
                >
                  <button
                    type="button"
                    className={styles.productButton}
                    aria-label={`${label}${count > 0 ? `, ${String(count)} Teller` : ""}`}
                    onClick={() => {
                      tapProduct(id);
                    }}
                  >
                    {soldOut && <span className={styles.tag}>ausverkauft</span>}
                    {label}
                  </button>
                  {count > 0 && (
                    <>
                      <button
                        type="button"
                        className={styles.minus}
                        aria-label={`${label} einen weniger`}
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            [id]: Math.max(0, (current[id] ?? 0) - 1),
                          }));
                        }}
                      >
                        −
                      </button>
                      <span className={styles.count}>{count}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className={styles.pagerColumn}>
          <h3 className={shared.heading}>Pager</h3>
          <PagerDisplay digits={digits} label="Pager-Nummer" bad={bad} />
          <div className={cx(styles.hint, bad && styles.bad)} role="note">
            {HINTS[check](pager === null ? "" : String(pager))}
          </div>
          <Keypad
            onKey={(key) => {
              setDigits((current) => pressKey(current, key));
            }}
          />
          <div className={shared.row}>
            <h3 className={cx(shared.heading, shared.grow, styles.subheading)}>
              {missingMode
                ? "Pager antippen, um ihn als fehlend zu markieren"
                : "Freie Pager"}
            </h3>
            <button
              type="button"
              className={cx(shared.small, shared.ghost)}
              onClick={() => {
                setMissingMode((on) => !on);
              }}
            >
              {missingMode ? "Fertig" : "Fehlt…"}
            </button>
          </div>
          <div
            className={cx(styles.quick, missingMode && styles.missingMode)}
            role="group"
            aria-label="Freie Pager"
          >
            {free.map((number) => (
              <button
                key={number}
                type="button"
                className={cx(pager === number && styles.selected)}
                aria-label={
                  missingMode
                    ? `Pager ${String(number)} als fehlend markieren`
                    : `Pager ${String(number)}`
                }
                onClick={() => {
                  if (missingMode) {
                    onMarkMissing(number);
                  } else {
                    setDigits(String(number));
                  }
                }}
              >
                {number}
              </button>
            ))}
          </div>
          {missing.length > 0 && (
            <div className={shared.muted}>
              Fehlend:{" "}
              {missing.map((number) => (
                <button
                  key={number}
                  type="button"
                  className={cx(shared.small, shared.ghost)}
                  aria-label={`Pager ${String(number)} wieder freigeben`}
                  onClick={() => {
                    onRestore(number);
                  }}
                >
                  {number} ↺
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={cx(shared.row, styles.footer)}>
        <button type="button" className={shared.ghost} onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className={cx(shared.go, shared.grow)}
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
              className={shared.warn}
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
