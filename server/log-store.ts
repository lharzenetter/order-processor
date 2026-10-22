import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

export type ReplaceReason = "push" | "newFest" | "import" | "overwrite";

const REPLACE_REASONS: readonly string[] = [
  "push",
  "newFest",
  "import",
  "overwrite",
];

export function isReplaceReason(value: unknown): value is ReplaceReason {
  return typeof value === "string" && REPLACE_REASONS.includes(value);
}

export interface LogHead {
  readonly logId: string;
  /** `previousLogId`, `formatVersion`, `device` and `reason` are null for the log minted at first start. */
  readonly previousLogId: string | null;
  readonly formatVersion: number | null;
  readonly device: string | null;
  readonly reason: ReplaceReason | null;
  readonly lastSeq: number;
}

/** An event as the server keeps it: the two fields it orders by, and the body as received. */
export interface StoredEvent {
  readonly id: string;
  readonly seq: number;
  readonly json: string;
}

export interface Replacement {
  readonly formatVersion: number;
  readonly device: string;
  readonly reason: ReplaceReason;
  readonly events: readonly StoredEvent[];
}

export interface ReplacedLog {
  readonly head: LogHead;
  readonly events: readonly string[];
}

export interface LogStore {
  head(): LogHead;
  ids(): string[];
  /** The stored JSON text of every event with a greater seq, in order. */
  eventsAfter(seq: number): string[];
  seqOf(id: string): number | undefined;
  append(event: StoredEvent): void;
  /**
   * Replaces the log in one transaction and returns the new logId. `archive` runs inside it, so a
   * failed archive write leaves the old log in place.
   */
  replace(next: Replacement, archive: (old: ReplacedLog) => void): string;
  /** `PRAGMA synchronous` of the connection: 2 is FULL. */
  synchronous(): number;
  close(): void;
}

type Row = Record<string, SQLOutputValue>;

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string")
    throw new Error(`Column ${column} is not text.`);
  return value;
}

function nullableText(row: Row, column: string): string | null {
  return row[column] === null ? null : text(row, column);
}

function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number")
    throw new Error(`Column ${column} is not an integer.`);
  return value;
}

function nullableInteger(row: Row, column: string): number | null {
  return row[column] === null ? null : integer(row, column);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS log (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    log_id TEXT NOT NULL,
    previous_log_id TEXT,
    format_version INTEGER,
    device TEXT,
    reason TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    body TEXT NOT NULL
  );
`;

export function openLogStore(file: string): LogStore {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  // An append is acknowledged only once it survives a pulled plug (spec, "HTTPS, host and network").
  db.exec("PRAGMA synchronous = FULL");
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO log (singleton, log_id) VALUES (1, ?)").run(
    randomUUID(),
  );

  const selectHead = db.prepare(`
    SELECT log_id, previous_log_id, format_version, device, reason,
      (SELECT COALESCE(MAX(seq), 0) FROM events) AS last_seq
    FROM log WHERE singleton = 1
  `);
  const selectIds = db.prepare("SELECT id FROM events ORDER BY seq");
  const selectAfter = db.prepare(
    "SELECT body FROM events WHERE seq > ? ORDER BY seq",
  );
  const selectSeq = db.prepare("SELECT seq FROM events WHERE id = ?");
  const insertEvent = db.prepare(
    "INSERT INTO events (seq, id, body) VALUES (?, ?, ?)",
  );
  const deleteEvents = db.prepare("DELETE FROM events");
  const updateLog = db.prepare(`
    UPDATE log SET log_id = ?, previous_log_id = ?, format_version = ?, device = ?, reason = ?
    WHERE singleton = 1
  `);

  function head(): LogHead {
    const row = selectHead.get();
    if (row === undefined) throw new Error("The log row is missing.");
    const reason = nullableText(row, "reason");
    return {
      logId: text(row, "log_id"),
      previousLogId: nullableText(row, "previous_log_id"),
      formatVersion: nullableInteger(row, "format_version"),
      device: nullableText(row, "device"),
      reason: isReplaceReason(reason) ? reason : null,
      lastSeq: integer(row, "last_seq"),
    };
  }

  function eventsAfter(seq: number): string[] {
    return selectAfter.all(seq).map((row) => text(row, "body"));
  }

  return {
    head,
    eventsAfter,
    ids() {
      return selectIds.all().map((row) => text(row, "id"));
    },
    seqOf(id) {
      const row = selectSeq.get(id);
      return row === undefined ? undefined : integer(row, "seq");
    },
    append(event) {
      insertEvent.run(event.seq, event.id, event.json);
    },
    replace(next, archive) {
      const logId = randomUUID();
      db.exec("BEGIN IMMEDIATE");
      try {
        const old = head();
        archive({ head: old, events: eventsAfter(0) });
        deleteEvents.run();
        for (const event of next.events)
          insertEvent.run(event.seq, event.id, event.json);
        updateLog.run(
          logId,
          old.logId,
          next.formatVersion,
          next.device,
          next.reason,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return logId;
    },
    synchronous() {
      const row = db.prepare("PRAGMA synchronous").get();
      if (row === undefined)
        throw new Error("PRAGMA synchronous returned nothing.");
      return integer(row, "synchronous");
    },
    close() {
      db.close();
    },
  };
}
