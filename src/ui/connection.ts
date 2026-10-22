import { assertNever } from "../core/index";
import type { LogChange } from "../storage/index";

export type Connection =
  "standalone" | "connecting" | "connected" | "disconnected" | "rejected";

export type RejectedReason = Extract<LogChange, { kind: "rejected" }>["reason"];

/** What moves the connection: the log's changes, plus Verbinden and Trennen in the Verwaltung. */
export type ConnectionChange =
  LogChange | { readonly kind: "connect" } | { readonly kind: "disconnect" };

/**
 * The connection the hook shows (spec, "The hook and its sync logic"). Once `disconnected`, the
 * strip stays through backoff until a connection succeeds, so it never flickers.
 */
export function nextConnection(
  previous: Connection,
  change: ConnectionChange,
): Connection {
  switch (change.kind) {
    case "connect":
      return previous === "standalone" ? "connecting" : previous;
    case "disconnect":
      return "standalone";
    case "appended":
    case "replaced":
    case "decide":
      return previous;
    case "rejected":
      return previous === "standalone" ? previous : "rejected";
    case "connection":
      if (previous === "standalone" || previous === "rejected") {
        return previous;
      }
      if (change.connection === "connecting") {
        return previous === "disconnected" ? "disconnected" : "connecting";
      }
      return change.connection;
    default:
      return assertNever(change);
  }
}

/** The status appended to the header's counts line. */
export function connectionLabel(
  connection: Connection,
  rejectedReason: RejectedReason | null,
  deviceName: string,
): string {
  switch (connection) {
    case "standalone":
      return "Eigenständig";
    case "connected":
      return `● Verbunden als ${deviceName}`;
    case "connecting":
      return "Verbinde…";
    case "disconnected":
      return "○ Keine Verbindung";
    case "rejected":
      return rejectedReason === "version"
        ? "○ Version passt nicht"
        : "○ Kopplungscode falsch";
    default:
      return assertNever(connection);
  }
}

/**
 * The Küchenanzeige's banner, or `null` while its numbers are live. A frozen count would have the
 * kitchen stop cooking, so every state but `connected` says the numbers are old.
 */
export function kitchenDisplayStale(
  connection: Connection,
  rejectedReason: RejectedReason | null,
  decidePending: boolean,
): string | null {
  // The answer may replace this iPad's log, so it is never given silently: staff give it at the
  // board, behind its export guard.
  if (decidePending) {
    return "Rückfrage vom Server – Küchenanzeige beenden (lange drücken)";
  }
  switch (connection) {
    case "connected":
      return null;
    case "connecting":
      return "Verbinde… – Zahlen veraltet";
    case "standalone":
    case "disconnected":
      return "Keine Verbindung – Zahlen veraltet";
    case "rejected":
      return rejectedReason === "version"
        ? "Version passt nicht – Zahlen veraltet"
        : "Kopplungscode falsch – Zahlen veraltet";
    default:
      return assertNever(connection);
  }
}

type FollowedBy = NonNullable<Extract<LogChange, { kind: "replaced" }>["by"]>;

/** The toast on an iPad that followed another iPad's replacement. */
export function followToast({ device, reason }: FollowedBy): string {
  switch (reason) {
    case "newFest":
      return `Neues Fest auf „${device}“ gestartet`;
    case "import":
      return `Protokoll von „${device}“ importiert`;
    case "overwrite":
      return `Server von „${device}“ überschrieben`;
    default:
      return assertNever(reason);
  }
}
