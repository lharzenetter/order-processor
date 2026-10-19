import { buzzedLines, handOnTarget } from "../core/index";
import type { State } from "../core/index";
import { cx } from "./cx";
import { formatSince } from "./format";
import styles from "./GerufenColumn.module.css";
import shared from "./shared.module.css";

export interface LineActions {
  readonly onRebuzz: (orderId: string, productId: string) => void;
  readonly onHandOn: (orderId: string, productId: string) => void;
  readonly onSendBack: (orderId: string, productId: string) => void;
}

/** Gerufen — wartet auf Abholung: every buzzed line, the oldest buzz first. */
export function GerufenColumn({
  state,
  now,
  onHandOver,
  onOpenOrder,
  actions,
}: {
  state: State;
  now: number;
  onHandOver: (orderId: string, productId: string, count: number) => void;
  onOpenOrder: (orderId: string) => void;
  actions: LineActions;
}) {
  const lines = buzzedLines(state, now);
  return (
    <section className={styles.column} aria-label="Gerufen">
      <h2 className={shared.heading}>Gerufen — wartet auf Abholung</h2>
      {lines.length === 0 && <p className={shared.muted}>Niemand gerufen.</p>}
      {lines.map((line) => (
        <div
          key={`${line.orderId}/${line.productId}`}
          className={cx(styles.line, line.rebuzzDue && styles.rebuzz)}
          role="group"
          aria-label={`Pager ${String(line.pager)} ${line.label}`}
        >
          <div className={shared.row}>
            <button
              type="button"
              className={cx(
                shared.chip,
                styles.pager,
                line.rebuzzDue
                  ? cx(shared.chipRebuzz, shared.pulse)
                  : shared.chipBuzzed,
              )}
              aria-label={`Pager ${String(line.pager)} öffnen`}
              onClick={() => {
                onOpenOrder(line.orderId);
              }}
            >
              {line.pager}
            </button>
            <b className={shared.grow}>
              {line.buzzed}× {line.label}
            </b>
            <span className={shared.muted}>
              {formatSince(line.sinceBuzzMs)}
            </span>
          </div>
          <button
            type="button"
            className={cx(shared.go, styles.handOver)}
            onClick={() => {
              onHandOver(line.orderId, line.productId, line.buzzed);
            }}
          >
            {line.buzzed} Teller ausgeben
          </button>
          <div className={styles.actions}>
            <LineActionButtons
              state={state}
              orderId={line.orderId}
              productId={line.productId}
              rebuzzDue={line.rebuzzDue}
              actions={actions}
            />
          </div>
        </div>
      ))}
    </section>
  );
}

/** Nochmal rufen, Weitergeben and Zurück in Warteschlange for one buzzed line. */
export function LineActionButtons({
  state,
  orderId,
  productId,
  rebuzzDue,
  actions,
}: {
  state: State;
  orderId: string;
  productId: string;
  rebuzzDue: boolean;
  actions: LineActions;
}) {
  return (
    <>
      <button
        type="button"
        className={cx(shared.small, rebuzzDue && shared.warn)}
        onClick={() => {
          actions.onRebuzz(orderId, productId);
        }}
      >
        Nochmal rufen
      </button>
      <button
        type="button"
        className={shared.small}
        disabled={handOnTarget(state, orderId, productId) === null}
        onClick={() => {
          actions.onHandOn(orderId, productId);
        }}
      >
        Weitergeben
      </button>
      <button
        type="button"
        className={cx(shared.small, shared.danger)}
        onClick={() => {
          actions.onSendBack(orderId, productId);
        }}
      >
        Zurück in Warteschlange
      </button>
    </>
  );
}
