import { assertNever } from "../core/index";
import { formatClock } from "./format";

/** The outcome of the last manual update check in this session. */
export type UpdateCheck =
  | { readonly phase: "idle" }
  | { readonly phase: "checking" }
  | { readonly phase: "current"; readonly checkedAt: number }
  | { readonly phase: "failed" };

export interface UpdateRow {
  readonly status: string;
  readonly action: "check" | "install";
  readonly label: string;
  readonly disabled: boolean;
}

/** What the Version row shows: one button that checks, and installs once an update is waiting. */
export function updateRow(
  check: UpdateCheck,
  waiting: boolean,
  waitingVersion: string | null,
): UpdateRow {
  if (waiting) {
    return {
      status:
        waitingVersion === null
          ? "Neue Version bereit"
          : `Neue Version ${waitingVersion} bereit`,
      action: "install",
      label: "Aktualisieren",
      disabled: false,
    };
  }
  return {
    status: checkStatus(check),
    action: "check",
    label: "Nach Updates suchen",
    disabled: check.phase === "checking",
  };
}

function checkStatus(check: UpdateCheck): string {
  switch (check.phase) {
    case "idle":
      return "Aktuell";
    case "checking":
      return "Suche nach Updates…";
    case "current":
      return `Aktuell · geprüft ${formatClock(check.checkedAt)}`;
    case "failed":
      return "Keine Verbindung · nicht geprüft";
    default:
      return assertNever(check);
  }
}
