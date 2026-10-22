import { soldOutWaiting } from "../core/index";
import type { State } from "../core/index";
import styles from "./Banners.module.css";
import type { Connection, RejectedReason } from "./connection";
import { formatClock } from "./format";
import { VERSION_TEXT } from "./server-settings";

export function SoldOutBanners({
  state,
  onOpenOrder,
}: {
  state: State;
  onOpenOrder: (orderId: string) => void;
}) {
  return soldOutWaiting(state).map(({ productId, label, orders }) => (
    <div key={productId} className={styles.soldOut}>
      {label} ausverkauft
      {orders.length === 0
        ? " — niemand wartet"
        : " — zur Kasse schicken & stornieren:"}
      {orders.map((order) => (
        <button
          key={order.orderId}
          type="button"
          className={styles.chip}
          aria-label={`Pager ${String(order.pager)} öffnen`}
          onClick={() => {
            onOpenOrder(order.orderId);
          }}
        >
          Pager {order.pager} ×{order.waiting}
        </button>
      ))}
    </div>
  ));
}

// It can't be closed: a browser tab works against separate, empty storage.
export function StandaloneBanner() {
  return (
    <div className={styles.standalone} role="alert">
      Nicht vom Home-Bildschirm gestartet. Bitte diesen Tab schließen und die
      App über das Symbol öffnen.
    </div>
  );
}

/** Under the header while taps don't count; never standalone. */
export function SyncStrip({
  connection,
  rejectedReason,
  since,
  onVerwaltung,
}: {
  connection: Connection;
  rejectedReason: RejectedReason | null;
  since: number | null;
  onVerwaltung: () => void;
}) {
  if (connection !== "disconnected" && connection !== "rejected") {
    return null;
  }
  return (
    <div className={styles.sync} role="alert">
      <div className={styles.syncText}>
        {connection === "disconnected" ? (
          <>
            Keine Verbindung zum Server. Anzeige vom Stand{" "}
            {since === null ? "–" : formatClock(since)}, Tippen gesperrt.
            <small>Server dauerhaft weg? Verwaltung → Trennen</small>
          </>
        ) : rejectedReason === "version" ? (
          VERSION_TEXT
        ) : (
          "Kopplungscode falsch. Der Server nimmt dieses iPad nicht an. In der Verwaltung den Code prüfen."
        )}
      </div>
      <button
        type="button"
        className={styles.syncButton}
        onClick={onVerwaltung}
      >
        Verwaltung
      </button>
    </div>
  );
}
