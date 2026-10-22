import { assertNever } from "../core/index";
import type { ServerTest } from "../storage/index";

const DAY_MS = 24 * 60 * 60_000;
const DEVICE_NAME_MAX = 20;
// A host name or IPv4 address with an optional port; no scheme, so http:// can't be entered.
const ADDRESS =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

export const VERSION_TEXT =
  "Diese App passt nicht zum Protokoll auf dem Server. Alle iPads und den Server auf dieselbe Version bringen (Verwaltung → Version).";

/** Below this, the Verwaltung warns to renew before the next Fest. */
export const CERT_WARN_DAYS = 14;

export function isServerAddress(address: string): boolean {
  const port = /:(\d+)$/.exec(address)?.[1];
  return (
    ADDRESS.test(address) && (port === undefined || Number(port) <= 65_535)
  );
}

/** What the device name's hint says instead, or `null` when the name is fine. */
export function deviceNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "Gerätename fehlt";
  }
  return trimmed.length > DEVICE_NAME_MAX ? "Höchstens 20 Zeichen" : null;
}

export function certDaysLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.floor((expiresAt - now) / DAY_MS));
}

export function serverTestText(result: ServerTest): string {
  switch (result.kind) {
    case "ok":
      return `Verbunden. Server hat ${String(result.eventCount)} Ereignisse.`;
    case "unreachable":
      return "Server nicht erreichbar. Adresse, WLAN und Zertifikat prüfen.";
    case "pairingCode":
      return "Kopplungscode falsch.";
    case "version":
      return VERSION_TEXT;
    default:
      return assertNever(result);
  }
}
