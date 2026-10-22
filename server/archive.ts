import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ReplacedLog } from "./log-store.ts";

// The archive is a plain export file, so a replaced log can go back to an iPad through Import. This
// is the server's own copy of the four-field shape: server/ imports nothing from src/.
const EXPORT_APP = "kirbe-pager";

export function archiveFileName(at: number, logId: string): string {
  return `${new Date(at).toISOString().replaceAll(":", "-")}-${logId}.json`;
}

/** Writes the replaced log to `archiveDir`, flushed to disk; an empty log writes nothing. */
export function writeArchive(
  archiveDir: string,
  at: number,
  old: ReplacedLog,
): void {
  if (old.events.length === 0) return;
  const file = {
    app: EXPORT_APP,
    formatVersion: old.head.formatVersion,
    exportedAt: at,
    events: old.events.map((json): unknown => JSON.parse(json)),
  };
  mkdirSync(archiveDir, { recursive: true });
  const descriptor = openSync(
    join(archiveDir, archiveFileName(at, old.head.logId)),
    "wx",
  );
  try {
    writeFileSync(descriptor, JSON.stringify(file));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
