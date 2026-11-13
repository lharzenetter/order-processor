import { assertNever } from "../core/index";
import type { PagerCallResult } from "../storage/index";
import type { PagerCallToast } from "./pager-call-toast";

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

export function groupCallToast(result: PagerCallResult): PagerCallToast {
  switch (result) {
    case "ok":
      return { text: "Alle Pager gerufen", stays: false, resend: false };
    case "failed":
      return {
        text: "Alle Pager rufen fehlgeschlagen",
        stays: true,
        resend: true,
      };
    case "notConnected":
      return { text: "Sender nicht verbunden", stays: true, resend: false };
    default:
      return assertNever(result);
  }
}
