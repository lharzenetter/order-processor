import type { PagerCallResult } from "../storage/index";
import { callToast } from "./pager-call-toast";
import type { CallToast } from "./pager-call-toast";

/**
 * What staff confirm before a group call while orders are open, since it reaches those orders'
 * guests too; `null` when none is open and it goes out right away (#33).
 */
export function groupCallQuestion(openOrders: number): string | null {
  if (openOrders === 0) {
    return null;
  }
  const orders = openOrders === 1 ? "Bestellung" : "Bestellungen";
  return `${String(openOrders)} ${orders} noch offen. Trotzdem alle Pager rufen?`;
}

export function groupCallToast(result: PagerCallResult): CallToast {
  return callToast(result, {
    ok: "Alle Pager gerufen",
    failed: "Alle Pager rufen fehlgeschlagen",
    notConnected: "Sender nicht verbunden",
  });
}
