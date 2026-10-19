import { headerCounts, undoTarget } from "../core/index";
import type { State } from "../core/index";
import styles from "./Header.module.css";

export function Header({
  state,
  onSoldOut,
  onUndo,
  onVerwaltung,
}: {
  state: State;
  onSoldOut: () => void;
  onUndo: () => void;
  onVerwaltung: () => void;
}) {
  const { openOrders, freePagers } = headerCounts(state);
  const target = undoTarget(state);
  const soldOutCount = state.soldOut.length;
  return (
    <header className={styles.header}>
      <span className={styles.title}>Kirbe Essensausgabe</span>
      <span className={styles.counts}>
        {openOrders} offen · {freePagers} Pager frei
      </span>
      <span className={styles.grow} />
      <button type="button" onClick={onSoldOut}>
        Ausverkauft markieren
        {soldOutCount > 0 && ` (${String(soldOutCount)})`}
      </button>
      <button
        type="button"
        className={styles.undo}
        disabled={target === null}
        onClick={onUndo}
      >
        ↶ Rückgängig
        <small>{target?.label ?? "nichts rückgängig zu machen"}</small>
      </button>
      <button
        type="button"
        className={styles.verwaltung}
        onClick={onVerwaltung}
      >
        Verwaltung
      </button>
    </header>
  );
}
