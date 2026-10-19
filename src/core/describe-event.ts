import { assertNever } from "./assert-never";
import type { Event, PlateCount } from "./event";
import { MENU } from "./menu";
import { labelOf } from "./selectors";
import type { State } from "./state";

/** The German label the Undo button and the undo toast show for an event. */
export function describeEvent(event: Event, state: State): string {
  function pagerOf(orderId: string): string {
    const order = state.orders.find((o) => o.id === orderId);
    return `Pager ${order === undefined ? "?" : String(order.pager)}`;
  }
  switch (event.type) {
    case "orderTaken":
      return `Neue Bestellung ${platesText(event.plates)} → Pager ${String(event.pager)}`;
    case "platesBuzzed":
      return `${event.count === 1 ? "" : `${String(event.count)}× `}${labelOf(event.productId)} gerufen → ${pagerOf(event.orderId)}`;
    case "plateHandedOn":
      return `${labelOf(event.productId)} weitergegeben: ${pagerOf(event.fromOrderId)} → ${pagerOf(event.toOrderId)}`;
    case "plateSentBackToQueue":
      return `${labelOf(event.productId)} für ${pagerOf(event.orderId)} zurück in Warteschlange`;
    case "rebuzzed":
      return `${pagerOf(event.orderId)} nochmal gerufen (${labelOf(event.productId)})`;
    case "platesHandedOver":
      return `Ausgabe ${pagerOf(event.orderId)}: ${platesText(event.plates)}`;
    case "platesCancelled":
      return `${String(event.count)}× ${labelOf(event.productId)} storniert auf ${pagerOf(event.orderId)}`;
    case "orderAbandoned":
      return `Bestellung auf ${pagerOf(event.orderId)} geschlossen${event.pagerBack ? "" : ", Pager fehlt"}`;
    case "pagerMarkedMissing":
      return `Pager ${String(event.pager)} als fehlend markiert`;
    case "pagerRestored":
      return `Pager ${String(event.pager)} wieder freigegeben`;
    case "soldOutMarked":
      return `${labelOf(event.productId)} ausverkauft`;
    case "soldOutCleared":
      return `${labelOf(event.productId)} wieder verfügbar`;
    case "actionUndone":
      return "Rückgängig";
    default:
      return assertNever(event);
  }
}

/** "1× Pommes, 2× Braten", in display order. */
export function platesText(plates: readonly PlateCount[]): string {
  return MENU.flatMap(({ id, label }) => {
    const plate = plates.find((p) => p.productId === id);
    return plate === undefined ? [] : [`${String(plate.count)}× ${label}`];
  }).join(", ");
}

/** What the next Undo reverts, or `null` when there is nothing to undo. */
export function undoTarget(
  state: State,
): { readonly event: Event; readonly label: string } | null {
  const event = state.live.at(-1);
  return event === undefined
    ? null
    : { event, label: describeEvent(event, state) };
}
