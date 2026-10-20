import { buzzedLines, REBUZZ_AFTER_MS } from "../core/index";
import type { State } from "../core/index";
import { cx } from "./cx";
import { formatSince } from "./format";
import styles from "./GerufenColumn.module.css";
import shared from "./shared.module.css";
import { StepHeading } from "./StepHeading";

const REBUZZ_HINT = `Über ${String(REBUZZ_AFTER_MS / 60_000)} Minuten – nochmal rufen`;

/** Step 3: Gast zeigt Pager …, then every buzzed line, the oldest buzz first. */
export function GerufenColumn({
  state,
  now,
  onShowPager,
  onHandOver,
  onRebuzz,
  onOpenOrder,
}: {
  state: State;
  now: number;
  onShowPager: () => void;
  onHandOver: (orderId: string, productId: string, count: number) => void;
  onRebuzz: (orderId: string, productId: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const lines = buzzedLines(state, now);
  return (
    <section className={styles.column} aria-labelledby="step-ausgeben">
      <StepHeading id="step-ausgeben" step="3" title="Ausgeben" />
      <button type="button" className={styles.showPager} onClick={onShowPager}>
        <b>Gast zeigt Pager …</b>
        <span className={shared.muted}>Nummer tippen</span>
      </button>
      <section className={styles.lines} aria-label="Gerufen">
        <h3 className={styles.subheading}>Gerufen · wartet auf Abholung</h3>
        {lines.length === 0 && <p className={shared.muted}>Niemand gerufen.</p>}
        {lines.map((line) => (
          <div
            key={`${line.orderId}/${line.productId}`}
            className={cx(styles.line, line.rebuzzDue && styles.rebuzz)}
            role="group"
            aria-label={`Pager ${String(line.pager)} ${line.label}`}
          >
            <div className={shared.row}>
              <span className={shared.tile}>{line.pager}</span>
              <span className={cx(shared.grow, styles.plates)}>
                {line.buzzed}× {line.label}
              </span>
              <span className={styles.since}>
                {formatSince(line.sinceBuzzMs)}
              </span>
            </div>
            {line.rebuzzDue && <div className={styles.hint}>{REBUZZ_HINT}</div>}
            <div className={shared.row}>
              <button
                type="button"
                className={cx(shared.primary, styles.handOver)}
                onClick={() => {
                  onHandOver(line.orderId, line.productId, line.buzzed);
                }}
              >
                {line.buzzed} Teller ausgeben
              </button>
              <button
                type="button"
                className={cx(
                  styles.rebuzzButton,
                  line.rebuzzDue && shared.secondary,
                )}
                onClick={() => {
                  onRebuzz(line.orderId, line.productId);
                }}
              >
                Nochmal rufen
              </button>
            </div>
            <button
              type="button"
              className={cx(shared.link, styles.more)}
              onClick={() => {
                onOpenOrder(line.orderId);
              }}
            >
              Weitere Aktionen…
            </button>
          </div>
        ))}
      </section>
    </section>
  );
}
