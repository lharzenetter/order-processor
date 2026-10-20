import { soldOutWaiting } from "../core/index";
import type { State } from "../core/index";
import styles from "./Banners.module.css";

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
