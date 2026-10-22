import { useState } from "react";
import { MENU, waitingPlates } from "../core/index";
import type { State } from "../core/index";
import { kitchenDisplayStale } from "./connection";
import type { Connection, RejectedReason } from "./connection";
import { cx } from "./cx";
import styles from "./KitchenDisplay.module.css";
import { LongPressButton } from "./LongPressButton";
import { ModalDialog } from "./ModalDialog";
import shared from "./shared.module.css";

type Overlay = "menu" | "auswahl";

/** The Küchenanzeige: only the waiting plates per product, and nothing it could record. */
export function KitchenDisplay({
  state,
  productSelection,
  connection,
  rejectedReason,
  decidePending,
  onSaveSelection,
  onEnd,
}: {
  state: State;
  productSelection: readonly string[];
  connection: Connection;
  rejectedReason: RejectedReason | null;
  decidePending: boolean;
  onSaveSelection: (productSelection: readonly string[]) => void;
  onEnd: () => void;
}) {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const tiles = waitingPlates(state, productSelection);
  const stale = kitchenDisplayStale(connection, rejectedReason, decidePending);
  // Every product chosen is gone from the menu after an update: nothing to show until a new Auswahl.
  const mustChoose = tiles.length === 0;

  return (
    <div className={styles.screen}>
      {stale !== null && (
        <p className={styles.stale} role="alert">
          {stale}
        </p>
      )}
      <div
        className={cx(styles.tiles, stale !== null && styles.staleTiles)}
        data-testid="kitchen-display"
      >
        {tiles.map(({ productId, label, waiting }) => (
          <div
            key={productId}
            role="group"
            aria-label={label}
            className={cx(styles.tile, waiting === 0 && styles.zero)}
          >
            <span className={styles.count}>{waiting}</span>
            <span className={styles.label}>{label}</span>
          </div>
        ))}
      </div>
      <div className={styles.corner}>
        <LongPressButton
          onLongPress={() => {
            setOverlay("menu");
          }}
        >
          Küchenanzeige
        </LongPressButton>
      </div>

      {overlay === "menu" && !mustChoose && (
        <ModalDialog
          title="Küchenanzeige"
          onClose={() => {
            setOverlay(null);
          }}
        >
          <div className={styles.stack}>
            <button
              type="button"
              className={shared.primary}
              onClick={() => {
                setOverlay("auswahl");
              }}
            >
              Auswahl ändern
            </button>
            <button type="button" className={shared.danger} onClick={onEnd}>
              Küchenanzeige beenden
            </button>
          </div>
        </ModalDialog>
      )}
      {(overlay === "auswahl" || mustChoose) && (
        <AuswahlDialog
          initial={productSelection}
          onSave={(chosen) => {
            setOverlay(null);
            onSaveSelection(chosen);
          }}
          {...(mustChoose
            ? {}
            : {
                onClose: () => {
                  setOverlay(null);
                },
              })}
        />
      )}
    </div>
  );
}

/** Chooses the products a Küchenanzeige shows; at least one. */
export function AuswahlDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: readonly string[];
  onSave: (productSelection: readonly string[]) => void;
  onClose?: () => void;
}) {
  const [chosen, setChosen] = useState<readonly string[]>(() =>
    initial.filter((id) => MENU.some((product) => product.id === id)),
  );

  return (
    <ModalDialog
      title="Auswahl für die Küchenanzeige"
      {...(onClose === undefined ? {} : { onClose })}
    >
      <p className={shared.muted}>
        Welche Gerichte soll dieses iPad zeigen? Es zeigt pro Gericht nur, wie
        viele Teller noch ausstehen.
      </p>
      <div className={styles.grid}>
        {MENU.map(({ id, label }) => {
          const selected = chosen.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              className={cx(styles.product, selected && styles.selected)}
              onClick={() => {
                setChosen(
                  selected
                    ? chosen.filter((other) => other !== id)
                    : [...chosen, id],
                );
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className={styles.stack}>
        <button
          type="button"
          className={shared.primary}
          disabled={chosen.length === 0}
          onClick={() => {
            onSave(chosen);
          }}
        >
          Küchenanzeige zeigen
        </button>
      </div>
    </ModalDialog>
  );
}
