import { useState } from "react";
import { MENU } from "../core/index";
import type { State } from "../core/index";
import { cx } from "./cx";
import { Keypad, PagerDisplay, pressKey } from "./Keypad";
import { ModalDialog } from "./ModalDialog";
import shared from "./shared.module.css";
import styles from "./SmallDialogs.module.css";
import { SoldOutTag } from "./SoldOutTag";

/** Ausgabe…: the guest shows a pager; its number opens the order. */
export function AusgabeDialog({
  onClose,
  onShow,
}: {
  onClose: () => void;
  onShow: (pager: string) => void;
}) {
  const [digits, setDigits] = useState("");
  return (
    <ModalDialog title="Ausgabe — Pager-Nummer" onClose={onClose}>
      <PagerDisplay digits={digits} label="Pager-Nummer" />
      <div className={styles.gap}>
        <Keypad
          onKey={(key) => {
            setDigits((current) => pressKey(current, key));
          }}
        />
      </div>
      <div className={styles.stack}>
        <button
          type="button"
          className={shared.primary}
          disabled={digits === ""}
          onClick={() => {
            onShow(digits);
          }}
        >
          Bestellung zeigen
        </button>
        <button type="button" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </ModalDialog>
  );
}

/** Stays until OK, so the pager is not forgotten. */
export function PagerReturnDialog({
  pager,
  onOk,
}: {
  pager: number;
  onOk: () => void;
}) {
  return (
    <ModalDialog title={`Pager ${String(pager)} zurücknehmen`} size="big">
      <p className={shared.muted}>
        Bestellung komplett. Der Pager ist wieder frei.
      </p>
      <div className={styles.stack}>
        <button type="button" className={shared.primary} onClick={onOk}>
          OK
        </button>
      </div>
    </ModalDialog>
  );
}

export function SoldOutDialog({
  state,
  onToggle,
  onClose,
}: {
  state: State;
  onToggle: (productId: string, soldOut: boolean) => void;
  onClose: () => void;
}) {
  return (
    <ModalDialog title="Ausverkauft markieren" onClose={onClose}>
      <p className={shared.muted}>
        Gericht umschalten, wenn die Küche nichts mehr hat. Der Kasse persönlich
        Bescheid geben.
      </p>
      <div className={styles.grid}>
        {MENU.map(({ id, label }) => {
          const soldOut = state.soldOut.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={soldOut}
              className={cx(styles.product, soldOut && styles.sold)}
              onClick={() => {
                onToggle(id, !soldOut);
              }}
            >
              {label}
              {soldOut && <SoldOutTag />}
            </button>
          );
        })}
      </div>
      <div className={styles.stack}>
        <button type="button" className={shared.primary} onClick={onClose}>
          Fertig
        </button>
      </div>
    </ModalDialog>
  );
}
