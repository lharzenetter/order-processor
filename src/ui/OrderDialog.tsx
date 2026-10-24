import { useState } from "react";
import { handOnTarget, orderView, platesText } from "../core/index";
import type {
  OrderView,
  OrderViewLine,
  PlateCount,
  State,
} from "../core/index";
import { cx } from "./cx";
import { formatClock, formatSince } from "./format";
import { handoverConsequence } from "./handover-consequence";
import { handOverLabel } from "./handover-text";
import { ModalDialog } from "./ModalDialog";
import styles from "./OrderDialog.module.css";
import shared from "./shared.module.css";
import { SoldOutTag } from "./SoldOutTag";

export interface LineActions {
  readonly onHandOn: (orderId: string, productId: string) => void;
  readonly onBackToQueue: (orderId: string, productId: string) => void;
}

/** The order popup, opened from any pager tile or Gast zeigt Pager …; `null` once the order closed. */
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
  const [rare, setRare] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  if (!view?.open) {
    return null;
  }
  const buzzed = view.lines.reduce((sum, l) => sum + l.buzzed, 0);
  const open = view.lines.reduce((sum, l) => sum + l.buzzed + l.waiting, 0);
  return (
    <ModalDialog
      title={`Pager ${String(view.pager)}`}
      heading={
        <span className={styles.heading}>
          <span className={cx(shared.tile, styles.pagerTile)}>
            {view.pager}
          </span>
          <span className={styles.headingText}>
            Pager {view.pager}
            <small className={shared.muted}>
              bestellt um {formatClock(view.takenAt)} · {buzzed} von {open}{" "}
              {open === 1 ? "Teller" : "Tellern"} gerufen
            </small>
          </span>
        </span>
      }
      onClose={onClose}
    >
      {note !== null && <p className={styles.note}>{note}</p>}
      {/* Remounting on every change presets the steppers to the buzzed counts again. */}
      <OrderLines
        key={view.lines
          .map((l) => `${l.productId}:${String(l.buzzed)}:${String(l.waiting)}`)
          .join()}
        view={view}
        onClose={onClose}
        onHandOver={onHandOver}
      />
      <button
        type="button"
        className={styles.rare}
        onClick={() => {
          setRare(true);
        }}
      >
        Etwas stimmt nicht …
      </button>
      {/* Its own dialog starts at the top, so a long order never pushes the actions out of sight. */}
      {rare && (
        <ModalDialog
          title={`Pager ${String(view.pager)} — etwas stimmt nicht`}
          onClose={() => {
            setRare(false);
          }}
        >
          <div className={styles.rareActions}>
            {view.lines.map((line) => (
              <RareLineActions
                key={line.productId}
                state={state}
                orderId={view.orderId}
                line={line}
                onCancelPlate={onCancelPlate}
                actions={actions}
              />
            ))}
            <button
              type="button"
              className={cx(styles.rareAction, styles.abandon)}
              onClick={() => {
                setAbandoning(true);
              }}
            >
              Verwaiste Bestellung schließen…
              <small>Gast ist weg</small>
            </button>
          </div>
        </ModalDialog>
      )}
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
  view,
  onClose,
  onHandOver,
}: {
  view: OrderView;
  onClose: () => void;
  onHandOver: (orderId: string, plates: readonly PlateCount[]) => void;
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
            className={styles.line}
            role="group"
            aria-label={line.label}
          >
            <div className={cx(shared.grow, styles.lineText)}>
              <span className={styles.lineTitle}>
                {open}× {line.label}
                {line.soldOut && <SoldOutTag />}
              </span>
              <span>
                {line.buzzed > 0 && (
                  <>
                    <b className={styles.buzzed}>{line.buzzed} gerufen</b>{" "}
                    <span
                      className={cx(
                        shared.muted,
                        line.rebuzzDue === true && styles.overdue,
                      )}
                    >
                      · Abholzeit {formatSince(line.pickupTimeMs ?? 0)}
                    </span>
                  </>
                )}
                {line.buzzed > 0 && line.waiting > 0 && " · "}
                {line.waiting > 0 && (
                  <span className={shared.muted}>
                    {line.waiting} wartet noch auf die Küche · Wartezeit{" "}
                    {formatSince(line.waitingTimeMs ?? 0)}
                  </span>
                )}
              </span>
            </div>
            <span className={styles.stepper}>
              <button
                type="button"
                disabled={taking === 0}
                aria-label={`Einen Teller ${line.label} weniger ausgeben`}
                onClick={() => {
                  step(-1);
                }}
              >
                −
              </button>
              <b aria-label={`${line.label} auszugeben`}>{taking}</b>
              <button
                type="button"
                disabled={taking === open}
                aria-label={`Einen Teller ${line.label} mehr ausgeben`}
                onClick={() => {
                  step(1);
                }}
              >
                +
              </button>
            </span>
          </div>
        );
      })}
      <div className={styles.footer}>
        {total > 0 && (
          <p className={cx(shared.muted, styles.consequence)}>
            {handoverConsequence(view, take)}
          </p>
        )}
        <div className={shared.row}>
          <button type="button" className={styles.close} onClick={onClose}>
            Schließen
          </button>
          <button
            type="button"
            className={cx(shared.primary, shared.grow, styles.handOver)}
            disabled={total === 0}
            onClick={() => {
              onHandOver(view.orderId, plates);
            }}
          >
            {handOverLabel(plates)}
          </button>
        </div>
      </div>
    </>
  );
}

/** Weitergeben and Zurück in Warteschlange for buzzed plates, Stornieren for waiting ones. */
function RareLineActions({
  state,
  orderId,
  line,
  onCancelPlate,
  actions,
}: {
  state: State;
  orderId: string;
  line: OrderViewLine;
  onCancelPlate: (orderId: string, productId: string) => void;
  actions: LineActions;
}) {
  const target =
    line.buzzed > 0 ? handOnTarget(state, orderId, line.productId) : null;
  return (
    <>
      {line.buzzed > 0 && (
        <>
          <button
            type="button"
            className={styles.rareAction}
            disabled={target === null}
            onClick={() => {
              actions.onHandOn(orderId, line.productId);
            }}
          >
            {line.label} weitergeben
            <small>
              {target === null
                ? "Niemand sonst wartet"
                : `Gast nicht da → an Pager ${String(target.pager)}`}
            </small>
          </button>
          <button
            type="button"
            className={styles.rareAction}
            onClick={() => {
              actions.onBackToQueue(orderId, line.productId);
            }}
          >
            {line.label} zurück in Warteschlange
            <small>Teller kaputt oder kalt</small>
          </button>
        </>
      )}
      {line.waiting > 0 && (
        <button
          type="button"
          className={styles.rareAction}
          onClick={() => {
            onCancelPlate(orderId, line.productId);
          }}
        >
          1 {line.label} stornieren
          <small>Bon falsch oder Geld zurück</small>
        </button>
      )}
    </>
  );
}
