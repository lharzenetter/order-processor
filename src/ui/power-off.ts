import { assertNever } from "../core/index";
import type { PagerCallResult } from "../storage/index";
import type { PagerCallToast } from "./pager-call-toast";

const WAY_BACK =
  "Alle Pager in der Ladestation ausschalten? Wieder einschalten: Ladestation aus- und einstecken, dann jeden Pager herausnehmen und wieder einsetzen.";

/**
 * What staff always confirm before a power-off, since a tap during service turns off the pagers
 * they hand out; while orders are open it names how many (#32).
 */
export function powerOffQuestion(openOrders: number): string {
  if (openOrders === 0) {
    return WAY_BACK;
  }
  const orders = openOrders === 1 ? "Bestellung" : "Bestellungen";
  return `${String(openOrders)} ${orders} noch offen. ${WAY_BACK}`;
}

export function powerOffToast(result: PagerCallResult): PagerCallToast {
  switch (result) {
    case "ok":
      return { text: "Pager ausgeschaltet", stays: false, resend: false };
    case "failed":
      return { text: "Ausschalten fehlgeschlagen", stays: true, resend: true };
    case "notConnected":
      return { text: "Sender nicht verbunden", stays: true, resend: false };
    default:
      return assertNever(result);
  }
}
