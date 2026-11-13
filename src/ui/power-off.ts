import type { PagerCallResult } from "../storage/index";
import { callToast } from "./pager-call-toast";
import type { CallToast } from "./pager-call-toast";

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

export function powerOffToast(result: PagerCallResult): CallToast {
  return callToast(result, {
    ok: "Pager ausgeschaltet",
    failed: "Ausschalten fehlgeschlagen",
    notConnected: "Sender nicht verbunden",
  });
}
