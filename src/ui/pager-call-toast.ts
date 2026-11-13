import { assertNever } from "../core/index";
import type { PagerCallResult } from "../storage/index";

export interface CallToast {
  readonly text: string;
  /** Stays until tapped away, so a guest who wasn't called can't be missed (#23). */
  readonly stays: boolean;
  /** Offers Erneut senden. */
  readonly resend: boolean;
}

/** The toast for a call's result, with the text each result shows. */
export function callToast(
  result: PagerCallResult,
  texts: {
    readonly ok: string;
    readonly failed: string;
    readonly notConnected: string;
  },
): CallToast {
  switch (result) {
    case "ok":
      return { text: texts.ok, stays: false, resend: false };
    case "failed":
      return { text: texts.failed, stays: true, resend: true };
    case "notConnected":
      return { text: texts.notConnected, stays: true, resend: false };
    default:
      return assertNever(result);
  }
}

export function pagerCallToast(
  pager: number,
  result: PagerCallResult,
): CallToast {
  const number = String(pager);
  return callToast(result, {
    ok: `Pager ${number} gerufen`,
    failed: `Pager ${number} nicht gerufen`,
    notConnected: `Sender nicht verbunden – Pager ${number} von Hand rufen`,
  });
}
