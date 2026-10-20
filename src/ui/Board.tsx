import { boardRows } from "../core/index";
import type { BoardRow, State } from "../core/index";
import styles from "./Board.module.css";
import { cx } from "./cx";
import shared from "./shared.module.css";
import { SoldOutTag } from "./SoldOutTag";
import { StepHeading } from "./StepHeading";

/** Step 2, the Übersicht: per product who gets the plate that just came out. */
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
    <section className={styles.column} aria-labelledby="step-rufen">
      <StepHeading
        id="step-rufen"
        step="2"
        title="Rufen"
        hint="Teller kommt raus → wer ist dran?"
      />
      {/* Rows keep the menu's display order even when idle, so a dish never moves. */}
      <div className={styles.board} aria-label="Übersicht" role="list">
        {boardRows(state).map((row) => (
          <div
            key={row.productId}
            role="listitem"
            aria-label={row.label}
            className={cx(styles.row, row.next === null && styles.idle)}
          >
            <span
              className={cx(
                styles.label,
                row.soldOut && row.next === null && styles.struck,
              )}
            >
              {row.label}
              {row.soldOut && row.next !== null && <SoldOutTag />}
            </span>
            {row.next === null ? (
              row.soldOut ? (
                <SoldOutTag />
              ) : (
                <span className={styles.nobody}>niemand wartet</span>
              )
            ) : (
              <ActiveRow
                row={row}
                next={row.next}
                onBuzz={onBuzz}
                onOpenOrder={onOpenOrder}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Reads left to right: next pager, rufen, Alle, then who queues behind. */
function ActiveRow({
  row,
  next,
  onBuzz,
  onOpenOrder,
}: {
  row: BoardRow;
  next: NonNullable<BoardRow["next"]>;
  onBuzz: (orderId: string, productId: string, count: number) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const pager = String(next.pager);
  return (
    <>
      <button
        type="button"
        className={cx(shared.tile, styles.next)}
        aria-label={`Bestellung Pager ${pager} öffnen`}
        onClick={() => {
          onOpenOrder(next.orderId);
        }}
      >
        {pager}
        <small>
          {next.calledCount}/{next.plateCount}
        </small>
      </button>
      <button
        type="button"
        className={cx(shared.primary, styles.buzz)}
        onClick={() => {
          onBuzz(next.orderId, row.productId, 1);
        }}
      >
        Pager {pager} rufen
      </button>
      {next.waiting > 1 ? (
        <button
          type="button"
          className={cx(shared.secondary, styles.all)}
          onClick={() => {
            onBuzz(next.orderId, row.productId, next.waiting);
          }}
        >
          Alle {next.waiting}
        </button>
      ) : (
        <span className={styles.all} />
      )}
      {row.queued.length > 0 && (
        <div className={styles.queue}>
          <span className={shared.muted}>danach</span>
          {row.queued.map((queued) => (
            <button
              key={queued.orderId}
              type="button"
              className={styles.queueChip}
              aria-label={`Bestellung Pager ${String(queued.pager)} öffnen`}
              onClick={() => {
                onOpenOrder(queued.orderId);
              }}
            >
              {queued.pager}
              {queued.waiting > 1 && ` ×${String(queued.waiting)}`}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
