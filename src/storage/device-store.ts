import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import { fold } from "../core/index";
import type { Event } from "../core/index";
import { isEvent, isRecord } from "./guards";

/**
 * The seam every state change goes through. A future server implements the same interface; core
 * and ui don't change.
 */
export interface EventLog {
  /** All events, in `seq` order. */
  load(): Promise<Event[]>;
  /** Resolves once the event is durably stored. */
  append(event: Event): Promise<void>;
}

/** Raise on any change to the stored or exported shape this build cannot read back. */
export const FORMAT_VERSION = 1;

export const DATABASE_NAME = "kirbe-pager";
const DATABASE_VERSION = 1;

export interface Meta {
  /** The format version of the stored log, which may be one this build can't read. */
  readonly formatVersion: unknown;
  readonly eventCount: number;
  readonly lastExportAt?: number;
  /** The result of `navigator.storage.persist()`. */
  readonly persisted?: boolean;
}

/** The JSON an export writes and an import reads. */
export interface ExportFile {
  readonly app: "kirbe-pager";
  readonly formatVersion: unknown;
  readonly exportedAt: number;
  readonly events: readonly unknown[];
}

/** The event log in IndexedDB, plus what the Verwaltung does with it. */
export interface DeviceStore extends EventLog {
  meta(): Promise<Meta>;
  /** The log as an export file; works on an unreadable log too, as it is. */
  exportFile(at: number): Promise<ExportFile>;
  recordExport(at: number): Promise<void>;
  recordPersisted(persisted: boolean): Promise<void>;
  /** Replaces the whole log. Throws `ImportRejectedError` and changes nothing if the file is unusable. */
  importFile(file: unknown): Promise<void>;
  /** Neues Fest starten: empties the log and resets meta, keeping the format version. */
  clear(): Promise<void>;
  close(): void;
}

export type OpenedStore =
  | { readonly status: "ready"; readonly store: DeviceStore }
  /** The stored log is of a format this build can't read: offer only export and import. */
  | { readonly status: "unreadable"; readonly store: DeviceStore };

export class ImportRejectedError extends Error {
  override readonly name = "ImportRejectedError";
}

interface Schema extends DBSchema {
  events: { key: number; value: unknown };
  meta: {
    key: "formatVersion" | "lastExportAt" | "persisted";
    value: unknown;
  };
}

type Database = IDBPDatabase<Schema>;

// Every write waits until the data is on disk: a tap is saved before the screen shows it.
const STRICT = { durability: "strict" } as const;

/** Opens the event log, creating it on first launch. It never wipes a log it can't read. */
export async function openDeviceStore(
  name: string = DATABASE_NAME,
): Promise<OpenedStore> {
  let db: Database;
  try {
    db = await openDB<Schema>(name, DATABASE_VERSION, {
      upgrade(database) {
        database.createObjectStore("events", { keyPath: "seq" });
        database.createObjectStore("meta");
      },
    });
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "VersionError") {
      throw error;
    }
    // A newer build upgraded the database: open it as it is, for export only.
    return {
      status: "unreadable",
      store: deviceStore(await openDB<Schema>(name)),
    };
  }
  let formatVersion = await db.get("meta", "formatVersion");
  if (formatVersion === undefined) {
    await db.put("meta", FORMAT_VERSION, "formatVersion");
    formatVersion = FORMAT_VERSION;
  }
  const store = deviceStore(db);
  return formatVersion === FORMAT_VERSION && (await isReadableLog(db))
    ? { status: "ready", store }
    : { status: "unreadable", store };
}

async function isReadableLog(db: Database): Promise<boolean> {
  const events = await db.getAll("events");
  if (!events.every(isEvent)) {
    return false;
  }
  try {
    fold(events);
    return true;
  } catch {
    return false;
  }
}

function deviceStore(db: Database): DeviceStore {
  return {
    async load() {
      const events = await db.getAll("events");
      // Checked at open; a record that is not an event here is a bug, never dropped silently.
      if (!events.every(isEvent)) {
        throw new Error("Das Protokoll enthält unbekannte Einträge");
      }
      return events;
    },
    async append(event) {
      const tx = db.transaction("events", "readwrite", STRICT);
      await Promise.all([tx.store.add(event), tx.done]);
    },
    async meta() {
      const tx = db.transaction(["events", "meta"], "readonly");
      const meta = tx.objectStore("meta");
      const [formatVersion, eventCount, lastExportAt, persisted] =
        await Promise.all([
          meta.get("formatVersion"),
          tx.objectStore("events").count(),
          meta.get("lastExportAt"),
          meta.get("persisted"),
        ]);
      return {
        formatVersion,
        eventCount,
        ...(typeof lastExportAt === "number" ? { lastExportAt } : {}),
        ...(typeof persisted === "boolean" ? { persisted } : {}),
      };
    },
    async exportFile(at) {
      const tx = db.transaction(["events", "meta"], "readonly");
      const [formatVersion, events] = await Promise.all([
        tx.objectStore("meta").get("formatVersion"),
        tx.objectStore("events").getAll(),
      ]);
      return { app: "kirbe-pager", formatVersion, exportedAt: at, events };
    },
    async recordExport(at) {
      await db.put("meta", at, "lastExportAt");
    },
    async recordPersisted(persisted) {
      await db.put("meta", persisted, "persisted");
    },
    async importFile(file) {
      const events = readableEvents(file);
      const tx = db.transaction(["events", "meta"], "readwrite", STRICT);
      const eventStore = tx.objectStore("events");
      await Promise.all([
        eventStore.clear(),
        ...events.map((event) => eventStore.add(event)),
        tx.objectStore("meta").put(FORMAT_VERSION, "formatVersion"),
        tx.done,
      ]);
    },
    async clear() {
      const tx = db.transaction(["events", "meta"], "readwrite", STRICT);
      const meta = tx.objectStore("meta");
      await Promise.all([
        tx.objectStore("events").clear(),
        meta.clear(),
        meta.put(FORMAT_VERSION, "formatVersion"),
        tx.done,
      ]);
    },
    close() {
      db.close();
    },
  };
}

// The same rule as at launch: a file this build can't read never replaces the log.
function readableEvents(file: unknown): readonly Event[] {
  if (
    !isRecord(file) ||
    file.app !== "kirbe-pager" ||
    !Array.isArray(file.events)
  ) {
    throw new ImportRejectedError("Keine Export-Datei dieser App");
  }
  if (file.formatVersion !== FORMAT_VERSION) {
    throw new ImportRejectedError(
      `Format ${String(file.formatVersion)} kann diese Version nicht lesen`,
    );
  }
  const events: readonly unknown[] = file.events;
  const valid = events.filter(isEvent).sort((a, b) => a.seq - b.seq);
  if (
    valid.length !== events.length ||
    new Set(valid.map((e) => e.seq)).size !== valid.length
  ) {
    throw new ImportRejectedError("Die Datei enthält unbekannte Ereignisse");
  }
  try {
    fold(valid);
  } catch {
    throw new ImportRejectedError(
      "Die Ereignisse der Datei passen nicht zusammen",
    );
  }
  return valid;
}
