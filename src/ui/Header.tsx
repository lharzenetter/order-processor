import { headerCounts, undoTarget } from "../core/index";
import type { State } from "../core/index";
import styles from "./Header.module.css";

export function Header({
  state,
  connectionStatus,
  actionsEnabled,
  onSoldOut,
  onUndo,
  onVerwaltung,
}: {
  state: State;
  /** Eigenständig, Verbunden als …: appended to the counts line. */
  connectionStatus: string;
  actionsEnabled: boolean;
  onSoldOut: () => void;
  onUndo: () => void;
  onVerwaltung: () => void;
}) {
  const { openOrders, freePagers } = headerCounts(state);
  const target = undoTarget(state);
  const soldOutCount = state.soldOut.length;
  return (
    <header className={styles.header}>
      <div className={styles.titles}>
        <span className={styles.title}>Kirbe Essensausgabe</span>
        <span className={styles.counts}>
          {openOrders} offen · {freePagers} Pager frei · {connectionStatus}
        </span>
      </div>
      <button
        type="button"
        className={styles.undo}
        disabled={target === null || !actionsEnabled}
        onClick={onUndo}
      >
        ↶ Rückgängig
        <small>{target?.label ?? "nichts rückgängig zu machen"}</small>
      </button>
      <button
        type="button"
        className={styles.textButton}
        disabled={!actionsEnabled}
        onClick={onSoldOut}
      >
        Ausverkauft…
        {soldOutCount > 0 && ` (${String(soldOutCount)})`}
      </button>
      <button
        type="button"
        className={styles.textButton}
        onClick={onVerwaltung}
      >
        Verwaltung
      </button>
    </header>
  );
}
