import { assertNever } from "../core/index";
import type { PagerCallResult } from "../storage/index";

export interface PagerCallToast {
  readonly text: string;
  /** Stays until tapped away, so a guest who wasn't called can't be missed (#23). */
  readonly stays: boolean;
  /** Offers Erneut senden. */
  readonly resend: boolean;
}

export function pagerCallToast(
  pager: number,
  result: PagerCallResult,
): PagerCallToast {
  const number = String(pager);
  switch (result) {
    case "ok":
      return { text: `Pager ${number} gerufen`, stays: false, resend: false };
    case "failed":
      return {
        text: `Pager ${number} nicht gerufen`,
        stays: true,
        resend: true,
      };
    case "notConnected":
      return {
        text: `Sender nicht verbunden – Pager ${number} von Hand rufen`,
        stays: true,
        resend: false,
      };
    default:
      return assertNever(result);
  }
}
