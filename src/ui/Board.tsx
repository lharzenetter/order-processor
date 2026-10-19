import { boardRows } from "../core/index";
import type { State } from "../core/index";
import styles from "./Board.module.css";
import { cx } from "./cx";
import shared from "./shared.module.css";

/** The Übersicht: per product who gets the plate that just came out. */
export function Board({
  state,
  onBuzz,
  onOpenOrder,
}: {
  state: State;
  onBuzz: (orderId: string, productId: string, count: number) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  return (
    <section className={styles.column} aria-label="Übersicht">
      <h2 className={shared.heading}>
        Übersicht — als Nächstes je Gericht (Pager antippen öffnet die
        Bestellung)
      </h2>
      <table className={styles.board}>
        <tbody>
          {boardRows(state).map((row) => (
            <tr
              key={row.productId}
              className={cx(row.soldOut && styles.sold)}
              aria-label={row.label}
            >
              <th scope="row" className={styles.label}>
                {row.label}
                {row.soldOut && <small> (ausverkauft)</small>}
              </th>
              {row.next === null ? (
                <td colSpan={4} className={shared.muted}>
                  —
                </td>
              ) : (
                <>
                  <td>
                    <button
                      type="button"
                      className={cx(shared.chip, styles.nextChip)}
                      aria-label={`Pager ${String(row.next.pager)} öffnen`}
                      onClick={() => {
                        if (row.next !== null) {
                          onOpenOrder(row.next.orderId);
                        }
                      }}
                    >
                      {row.next.pager}
                    </button>
                  </td>
                  <td className={styles.progress}>
                    {row.next.calledCount} von {row.next.plateCount} gerufen
                  </td>
                  <td className={styles.actions}>
                    <button
                      type="button"
                      className={cx(shared.go, shared.small)}
                      onClick={() => {
                        if (row.next !== null) {
                          onBuzz(row.next.orderId, row.productId, 1);
                        }
                      }}
                    >
                      {row.next.pager} rufen
                    </button>
                    {row.next.waiting > 1 && (
                      <button
                        type="button"
                        className={shared.small}
                        onClick={() => {
                          if (row.next !== null) {
                            onBuzz(
                              row.next.orderId,
                              row.productId,
                              row.next.waiting,
                            );
                          }
                        }}
                      >
                        Alle {row.next.waiting}
                      </button>
                    )}
                  </td>
                  <td>
                    <div className={styles.queue}>
                      {row.queued.map((queued) => (
                        <button
                          key={queued.orderId}
                          type="button"
                          className={cx(shared.chip, styles.queueChip)}
                          aria-label={`Pager ${String(queued.pager)} öffnen`}
                          onClick={() => {
                            onOpenOrder(queued.orderId);
                          }}
                        >
                          {queued.pager}
                          {queued.waiting > 1 && `×${String(queued.waiting)}`}
                        </button>
                      ))}
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
