import { useState } from "react";
import { orderView, platesText } from "../core/index";
import type { OrderView, PlateCount, State } from "../core/index";
import { cx } from "./cx";
import { formatClock, formatSince } from "./format";
import { LineActionButtons } from "./GerufenColumn";
import type { LineActions } from "./GerufenColumn";
import { ModalDialog } from "./ModalDialog";
import styles from "./OrderDialog.module.css";
import shared from "./shared.module.css";

/** The order popup, opened from any pager chip or Ausgabe…; `null` once the order closed. */
export function OrderDialog({
  state,
  now,
  orderId,
  note,
  onClose,
  onHandOver,
  onCancelPlate,
  onAbandon,
  actions,
}: {
  state: State;
  now: number;
  orderId: string;
  /** Shown after a partial handover: "Pager N bleibt beim Gast — noch offen:". */
  note: string | null;
  onClose: () => void;
  onHandOver: (orderId: string, plates: readonly PlateCount[]) => void;
  onCancelPlate: (orderId: string, productId: string) => void;
  onAbandon: (orderId: string, pagerBack: boolean) => void;
  actions: LineActions;
}) {
  const view = orderView(state, orderId, now);
  const [abandoning, setAbandoning] = useState(false);
  if (!view?.open) {
    return null;
  }
  return (
    <ModalDialog
      title={`Pager ${String(view.pager)}`}
      heading={
        <>
          {note !== null && <span className={styles.note}>{note}</span>}
          Pager {view.pager}{" "}
          <small className={shared.muted}>
            bestellt um {formatClock(view.takenAt)}
          </small>
        </>
      }
      onClose={onClose}
    >
      {/* Remounting on every change presets the steppers to the buzzed counts again. */}
      <OrderLines
        key={view.lines
          .map((l) => `${l.productId}:${String(l.buzzed)}:${String(l.waiting)}`)
          .join()}
        state={state}
        view={view}
        onClose={onClose}
        onHandOver={onHandOver}
        onCancelPlate={onCancelPlate}
        onAbandon={() => {
          setAbandoning(true);
        }}
        actions={actions}
      />
      {abandoning && (
        <ModalDialog
          title={`Bestellung auf Pager ${String(view.pager)} schließen?`}
          onClose={() => {
            setAbandoning(false);
          }}
        >
          <p className={shared.muted}>
            Noch offen:{" "}
            {platesText(
              view.lines.map((l) => ({
                productId: l.productId,
                count: l.buzzed + l.waiting,
              })),
            )}
            . Gerufene Teller zählen als nicht ausgegeben, der Rest als
            storniert. Ist der Pager zurück?
          </p>
          <div className={styles.stack}>
            <button
              type="button"
              className={shared.primary}
              onClick={() => {
                onAbandon(view.orderId, true);
              }}
            >
              Schließen — Pager ist zurück
            </button>
            <button
              type="button"
              className={shared.danger}
              onClick={() => {
                onAbandon(view.orderId, false);
              }}
            >
              Schließen — Pager fehlt
            </button>
            <button
              type="button"
              onClick={() => {
                setAbandoning(false);
              }}
            >
              Bestellung offen lassen
            </button>
          </div>
        </ModalDialog>
      )}
    </ModalDialog>
  );
}

function OrderLines({
  state,
  view,
  onClose,
  onHandOver,
  onCancelPlate,
  onAbandon,
  actions,
}: {
  state: State;
  view: OrderView;
  onClose: () => void;
  onHandOver: (orderId: string, plates: readonly PlateCount[]) => void;
  onCancelPlate: (orderId: string, productId: string) => void;
  onAbandon: () => void;
  actions: LineActions;
}) {
  const [take, setTake] = useState<Readonly<Record<string, number>>>(() =>
    Object.fromEntries(view.lines.map((l) => [l.productId, l.buzzed])),
  );
  const plates = view.lines.flatMap(({ productId }) => {
    const count = take[productId] ?? 0;
    return count > 0 ? [{ productId, count }] : [];
  });
  const total = plates.reduce((sum, p) => sum + p.count, 0);

  return (
    <>
      {view.lines.map((line) => {
        const open = line.buzzed + line.waiting;
        const taking = take[line.productId] ?? 0;
        function step(by: number): void {
          setTake((current) => ({
            ...current,
            [line.productId]: Math.min(
              open,
              Math.max(0, (current[line.productId] ?? 0) + by),
            ),
          }));
        }
        return (
          <div
            key={line.productId}
            className={cx(
              styles.line,
              line.rebuzzDue === true && styles.rebuzz,
            )}
            role="group"
            aria-label={line.label}
          >
            <div className={shared.row}>
              <b className={cx(shared.grow, styles.lineTitle)}>
                {open}× {line.label}
              </b>
              <span className={styles.stepper}>
                <button
                  type="button"
                  className={shared.small}
                  aria-label={`${line.label} einen weniger ausgeben`}
                  onClick={() => {
                    step(-1);
                  }}
                >
                  −
                </button>
                <b aria-label={`${line.label} auszugeben`}>{taking}</b>
                <button
                  type="button"
                  className={shared.small}
                  aria-label={`${line.label} einen mehr ausgeben`}
                  onClick={() => {
                    step(1);
                  }}
                >
                  +
                </button>
              </span>
            </div>
            <div className={cx(shared.row, shared.wrap, styles.lineInfo)}>
              {line.buzzed > 0 && (
                <span
                  className={cx(
                    shared.chip,
                    line.rebuzzDue === true
                      ? shared.chipRebuzz
                      : shared.chipBuzzed,
                  )}
                >
                  {line.buzzed} gerufen · {formatSince(line.sinceBuzzMs ?? 0)}
                </span>
              )}
              {line.waiting > 0 && (
                <span className={shared.chip}>
                  {line.waiting} wartet{line.soldOut && " · AUSVERKAUFT"}
                </span>
              )}
              <span className={shared.grow} />
              {line.buzzed > 0 && (
                <LineActionButtons
                  state={state}
                  orderId={view.orderId}
                  productId={line.productId}
                  rebuzzDue={line.rebuzzDue === true}
                  actions={actions}
                />
              )}
              {line.waiting > 0 && (
                <button
                  type="button"
                  className={cx(shared.small, shared.danger)}
                  onClick={() => {
                    onCancelPlate(view.orderId, line.productId);
                  }}
                >
                  1 stornieren
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div className={cx(shared.row, styles.footer)}>
        <button
          type="button"
          className={cx(shared.small, shared.ghost, shared.danger)}
          onClick={onAbandon}
        >
          Verwaiste Bestellung schließen…
        </button>
        <span className={shared.grow} />
        <button type="button" onClick={onClose}>
          Schließen
        </button>
        <button
          type="button"
          className={shared.go}
          disabled={total === 0}
          onClick={() => {
            onHandOver(view.orderId, plates);
          }}
        >
          {total} Teller ausgeben
        </button>
      </div>
    </>
  );
}
