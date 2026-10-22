import { useEffect, useRef, useState } from "react";
import {
  handOnTarget,
  labelOf,
  openOrderByPager,
  orderView,
  pagerOverview,
} from "../core/index";
import type { EventBody, PlateCount, State } from "../core/index";
import styles from "./App.module.css";
import { SoldOutBanners, StandaloneBanner, SyncStrip } from "./Banners";
import { Board } from "./Board";
import { connectionLabel } from "./connection";
import { cx } from "./cx";
import { GerufenColumn } from "./GerufenColumn";
import { handedOverText } from "./handover-text";
import { Header } from "./Header";
import { IntakeDialog } from "./IntakeDialog";
import { KitchenDisplay } from "./KitchenDisplay";
import { OrderDialog } from "./OrderDialog";
import type { LineActions } from "./OrderDialog";
import shared from "./shared.module.css";
import {
  AusgabeDialog,
  PagerReturnDialog,
  SoldOutDialog,
} from "./SmallDialogs";
import { StepHeading } from "./StepHeading";
import { DecideDialog } from "./SyncDialogs";
import { Toasts, useToasts } from "./Toasts";
import { useDevice } from "./use-device";
import { usePagerBoard } from "./use-pager-board";
import { Verwaltung } from "./Verwaltung";

type Dialog =
  | { readonly kind: "intake" }
  | { readonly kind: "ausgabe" }
  | { readonly kind: "soldOut" }
  | {
      readonly kind: "order";
      readonly orderId: string;
      readonly note: string | null;
    }
  | {
      readonly kind: "pagerReturn";
      readonly pager: number;
      readonly handedOver: readonly PlateCount[] | null;
    };

export function App() {
  const { toasts, showToast } = useToasts();
  const board = usePagerBoard(showToast);
  const device = useDevice();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [verwaltungOpen, setVerwaltungOpen] = useState(false);
  const { state, now, status, store, connection, decide, pending } = board;
  const tappedRef = useRef<HTMLButtonElement | null>(null);
  // In sync mode the board stays readable but takes no taps until the server counts them.
  const locked =
    decide !== null ||
    connection === "connecting" ||
    connection === "disconnected" ||
    connection === "rejected";

  useEffect(() => {
    function remember(event: PointerEvent): void {
      tappedRef.current =
        event.target instanceof Element ? event.target.closest("button") : null;
    }
    document.addEventListener("pointerdown", remember, true);
    return () => {
      document.removeEventListener("pointerdown", remember, true);
    };
  }, []);

  // The spinner sits on the tapped button itself; global.css shows it only after 300 ms.
  useEffect(() => {
    const button = tappedRef.current;
    if (!pending || button === null) {
      return;
    }
    button.dataset.pending = "";
    return () => {
      delete button.dataset.pending;
    };
  }, [pending]);

  // Every action goes through the log; a refused event is a bug, shown rather than swallowed.
  async function run(body: EventBody): Promise<State | null> {
    if (!board.actionsEnabled) {
      return null;
    }
    try {
      return await board.dispatch(body);
    } catch (error) {
      showToast(`Fehler: ${String(error)}`);
      return null;
    }
  }

  // After every handover, and after a cancel that empties the order: take the pager back, or
  // show what the guest is still owed. A cancel inside the open popup just leaves it open.
  // `handedOver` is null for a cancel; for a handover it names the plates, as they leave the popup.
  function afterChange(
    next: State | null,
    orderId: string,
    handedOver: readonly PlateCount[] | null,
  ): void {
    const view = next === null ? null : orderView(next, orderId, now);
    if (view === null) {
      return;
    }
    if (!view.open) {
      setDialog({ kind: "pagerReturn", pager: view.pager, handedOver });
    } else if (handedOver !== null) {
      setDialog({
        kind: "order",
        orderId,
        note: `${handedOverText(handedOver)} Pager ${String(view.pager)} bleibt beim Gast — noch offen:`,
      });
    }
  }

  function openOrder(orderId: string): void {
    setDialog({ kind: "order", orderId, note: null });
  }

  async function handOver(
    orderId: string,
    plates: readonly PlateCount[],
  ): Promise<void> {
    afterChange(
      await run({ type: "platesHandedOver", orderId, plates }),
      orderId,
      plates,
    );
  }

  const lineActions: LineActions = {
    onHandOn(orderId, productId) {
      const target = handOnTarget(state, orderId, productId);
      if (target === null) {
        return;
      }
      void run({
        type: "plateHandedOn",
        fromOrderId: orderId,
        toOrderId: target.id,
        productId,
      }).then((next) => {
        if (next !== null) {
          showToast(`Jetzt Pager ${String(target.pager)} rufen`);
        }
      });
    },
    onBackToQueue(orderId, productId) {
      void run({ type: "plateSentBackToQueue", orderId, productId }).then(
        (next) => {
          if (next !== null) {
            showToast(`Küche Bescheid geben: noch ein ${labelOf(productId)}`);
          }
        },
      );
    },
  };

  if (status.kind === "loading") {
    return <p className={styles.message}>Lade…</p>;
  }
  if (status.kind === "failed") {
    return (
      <p className={styles.message} role="alert">
        Das Protokoll lässt sich nicht öffnen: {status.message}
      </p>
    );
  }
  if (store === null) {
    return null;
  }
  if (status.kind === "unreadable") {
    return (
      <>
        <Verwaltung
          mode="recovery"
          board={board}
          device={device}
          showToast={showToast}
        />
        <Toasts toasts={toasts} />
      </>
    );
  }

  // The Küchenanzeige records nothing, so none of the window's controls, dialogs or toasts show.
  const kitchenDisplay = board.meta?.kitchenDisplay;
  if (kitchenDisplay !== undefined) {
    return (
      <KitchenDisplay
        state={state}
        productSelection={kitchenDisplay}
        connection={connection}
        rejectedReason={board.rejectedReason}
        decidePending={decide !== null}
        onSaveSelection={(productSelection) => {
          void board.saveKitchenDisplay(productSelection);
        }}
        onEnd={() => {
          void board.endKitchenDisplay();
        }}
      />
    );
  }

  const { free, allOut } = pagerOverview(state);

  return (
    <div className={styles.app}>
      {!device.standalone && <StandaloneBanner />}
      <Header
        state={state}
        connectionStatus={connectionLabel(
          connection,
          board.rejectedReason,
          board.meta?.deviceName ?? "",
        )}
        actionsEnabled={board.actionsEnabled}
        onSoldOut={() => {
          setDialog({ kind: "soldOut" });
        }}
        onUndo={() => {
          void board
            .undo()
            .then((label) => {
              if (label !== null) {
                showToast(`Rückgängig: ${label}`);
              }
            })
            .catch((error: unknown) => {
              showToast(`Fehler: ${String(error)}`);
            });
        }}
        onVerwaltung={() => {
          setVerwaltungOpen(true);
        }}
      />
      <SyncStrip
        connection={connection}
        rejectedReason={board.rejectedReason}
        since={board.blockedSince}
        onVerwaltung={() => {
          setVerwaltungOpen(true);
        }}
      />
      <div
        className={cx(styles.board, locked && styles.locked)}
        inert={locked || pending}
        data-testid="board"
      >
        <SoldOutBanners state={state} onOpenOrder={openOrder} />
        <div className={styles.shell}>
          <section className={styles.intake} aria-labelledby="step-annehmen">
            <StepHeading id="step-annehmen" step="1" title="Annehmen" />
            <button
              type="button"
              className={cx(shared.primary, styles.newOrder)}
              disabled={allOut}
              onClick={() => {
                setDialog({ kind: "intake" });
              }}
            >
              {allOut ? (
                "Alle Pager vergeben"
              ) : (
                <>
                  <span className={styles.plus}>+</span> Neue Bestellung
                  <small>{free.length} Pager frei</small>
                </>
              )}
            </button>
            <p className={cx(shared.muted, styles.intakeHint)}>
              Bon abtippen, Pager vom Stapel nehmen, Nummer antippen.
            </p>
          </section>
          <Board
            state={state}
            onBuzz={(orderId, productId, count) => {
              void run({ type: "platesBuzzed", orderId, productId, count });
            }}
            onOpenOrder={openOrder}
          />
          <GerufenColumn
            state={state}
            now={now}
            onShowPager={() => {
              setDialog({ kind: "ausgabe" });
            }}
            onRebuzz={(orderId, productId) => {
              void run({ type: "rebuzzed", orderId, productId });
            }}
            onOpenOrder={openOrder}
          />
        </div>
      </div>

      {decide !== null && (
        <DecideDialog
          question={decide}
          store={store}
          onPush={() => {
            void board.pushLocal().then((result) => {
              if (result.kind === "conflict") {
                showToast("Das Protokoll wurde inzwischen ersetzt");
              }
            });
          }}
          onAdopt={() => {
            void board.adoptServer();
          }}
          onCancel={() => {
            void board.disconnect().then(() => {
              showToast("Nicht verbunden — dieses iPad bleibt eigenständig");
            });
          }}
        />
      )}
      {/* All taps are inert while a tap is on its way, the dialogs' included. A dialog opened
          before the board locked would take taps that can't count, so it is set aside until the board unlocks. */}
      {!locked && (
        <div className={styles.dialogs} inert={pending}>
          {dialog?.kind === "intake" && (
            <IntakeDialog
              state={state}
              onClose={() => {
                setDialog(null);
              }}
              onTakeOrder={(pager, plates) => {
                void run({ type: "orderTaken", pager, plates }).then((next) => {
                  if (next !== null) {
                    setDialog(null);
                    showToast(`Bestellung auf Pager ${String(pager)}`);
                  }
                });
              }}
              onMarkMissing={(pager) => {
                void run({ type: "pagerMarkedMissing", pager });
              }}
              onRestore={(pager) => {
                void run({ type: "pagerRestored", pager });
              }}
            />
          )}
          {dialog?.kind === "ausgabe" && (
            <AusgabeDialog
              onClose={() => {
                setDialog(null);
              }}
              onShow={(digits) => {
                const pager = Number(digits);
                const order = openOrderByPager(state, pager);
                if (order === null) {
                  setDialog(null);
                  showToast(
                    `Keine offene Bestellung auf Pager ${String(pager)}`,
                  );
                } else {
                  openOrder(order.id);
                }
              }}
            />
          )}
          {dialog?.kind === "order" && (
            <OrderDialog
              key={`${dialog.orderId}/${dialog.note ?? ""}`}
              state={state}
              now={now}
              orderId={dialog.orderId}
              note={dialog.note}
              onClose={() => {
                setDialog(null);
              }}
              onHandOver={(orderId, plates) => {
                void handOver(orderId, plates);
              }}
              onCancelPlate={(orderId, productId) => {
                void run({
                  type: "platesCancelled",
                  orderId,
                  productId,
                  count: 1,
                }).then((next) => {
                  afterChange(next, orderId, null);
                });
              }}
              onAbandon={(orderId, pagerBack) => {
                void run({ type: "orderAbandoned", orderId, pagerBack }).then(
                  () => {
                    setDialog(null);
                  },
                );
              }}
              actions={lineActions}
            />
          )}
          {dialog?.kind === "pagerReturn" && (
            <PagerReturnDialog
              pager={dialog.pager}
              handedOver={dialog.handedOver}
              onOk={() => {
                setDialog(null);
              }}
            />
          )}
          {dialog?.kind === "soldOut" && (
            <SoldOutDialog
              state={state}
              onToggle={(productId, soldOut) => {
                void run({
                  type: soldOut ? "soldOutMarked" : "soldOutCleared",
                  productId,
                });
              }}
              onClose={() => {
                setDialog(null);
              }}
            />
          )}
        </div>
      )}
      {verwaltungOpen && (
        <Verwaltung
          mode="full"
          board={board}
          device={device}
          onBack={() => {
            setVerwaltungOpen(false);
          }}
          showToast={showToast}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
