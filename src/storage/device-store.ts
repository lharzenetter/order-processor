import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import { fold } from "../core/index";
import type { Event } from "../core/index";
import { isEvent, isRecord } from "./guards";

/**
 * The seam every state change goes through: the `DeviceStore` standalone, a `ServerLog` in sync
 * mode. Core and ui don't change between them.
 */
export interface EventLog {
  /** All events, in `seq` order. */
  load(): Promise<Event[]>;
  /** Resolves once the event counts: durably stored, or appended by the server. */
  append(event: Event): Promise<AppendResult>;
  /** Changes that didn't come from this iPad's `append`; returns the unsubscribe. */
  subscribe(listener: (change: LogChange) => void): () => void;
}

export type AppendResult =
  | { readonly kind: "appended" }
  /** Others appended first; `missed` is already in the mirror, from the tap's `seq` on. */
  | { readonly kind: "stale"; readonly missed: readonly Event[] }
  /** The log was replaced or the iPad disconnected before the tap counted. */
  | { readonly kind: "dropped" };

export type ReplaceReason = "push" | "newFest" | "import" | "overwrite";

export type LogChange =
  | { readonly kind: "appended"; readonly events: readonly Event[] }
  | {
      /** The hook reloads. */
      readonly kind: "replaced";
      /** Set when another iPad replaced the log; drives the follow toast. */
      readonly by?: {
        readonly device: string;
        readonly reason: Exclude<ReplaceReason, "push">;
      };
    }
  | {
      readonly kind: "connection";
      /** `connecting` whenever an attempt starts; the hook keeps a blocked strip through backoff. */
      readonly connection: "connecting" | "connected" | "disconnected";
    }
  | { readonly kind: "rejected"; readonly reason: "pairingCode" | "version" }
  | { readonly kind: "decide"; readonly question: DecideQuestion };

export type DecideQuestion =
  | { readonly kind: "serverEmpty"; readonly localCount: number }
  | {
      readonly kind: "diverged";
      readonly localCount: number;
      readonly serverCount: number;
    };

/** What the Verwaltung's Server section saves; kept in `meta`, never in the log or an export. */
export interface SyncSettings {
  /** A host name with an optional `:port`; `https://` is implied. */
  readonly serverAddress: string;
  readonly pairingCode: string;
  readonly deviceName: string;
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
  /** Set only in sync mode; an empty address means standalone. */
  readonly serverAddress?: string;
  readonly pairingCode?: string;
  readonly deviceName?: string;
  /** The server log the mirror belongs to. */
  readonly logId?: string;
  /** The highest `seq` the mirror knows the server has. */
  readonly serverSeq?: number;
  /** Set while this iPad is a Küchenanzeige: its product selection. */
  readonly kitchenDisplay?: readonly string[];
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
  /**
   * Neues Fest starten standalone: empties the log and resets meta, keeping the format version
   * and the connection settings.
   */
  clear(): Promise<void>;
  /** The one replacement: `logId` is the server log's in sync mode, `null` standalone. */
  replaceLog(events: readonly Event[], logId: string | null): Promise<void>;
  /** Mirrors events the server has appended, with the log they belong to. */
  recordFromServer(
    events: readonly Event[],
    logId: string,
    serverSeq: number,
  ): Promise<void>;
  saveSettings(settings: SyncSettings): Promise<void>;
  /** Trennen: the mirror, its log and the other settings stay for reconnecting. */
  clearServerAddress(): Promise<void>;
  /** Makes this iPad a Küchenanzeige, or changes its product selection; survives a restart. */
  saveKitchenDisplay(productSelection: readonly string[]): Promise<void>;
  endKitchenDisplay(): Promise<void>;
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
    key: MetaKey;
    value: unknown;
  };
}

type MetaKey =
  | "formatVersion"
  | "lastExportAt"
  | "persisted"
  | keyof SyncSettings
  | "logId"
  | "serverSeq"
  | "kitchenDisplay";

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
      return { kind: "appended" };
    },
    subscribe() {
      // Standalone, nothing changes the log but this iPad's own appends.
      return () => undefined;
    },
    async meta() {
      const tx = db.transaction(["events", "meta"], "readonly");
      const meta = tx.objectStore("meta");
      const [
        formatVersion,
        eventCount,
        lastExportAt,
        persisted,
        serverAddress,
        pairingCode,
        deviceName,
        logId,
        serverSeq,
        kitchenDisplay,
      ] = await Promise.all([
        meta.get("formatVersion"),
        tx.objectStore("events").count(),
        meta.get("lastExportAt"),
        meta.get("persisted"),
        meta.get("serverAddress"),
        meta.get("pairingCode"),
        meta.get("deviceName"),
        meta.get("logId"),
        meta.get("serverSeq"),
        meta.get("kitchenDisplay"),
      ]);
      return {
        formatVersion,
        eventCount,
        ...(typeof lastExportAt === "number" ? { lastExportAt } : {}),
        ...(typeof persisted === "boolean" ? { persisted } : {}),
        ...(typeof serverAddress === "string" ? { serverAddress } : {}),
        ...(typeof pairingCode === "string" ? { pairingCode } : {}),
        ...(typeof deviceName === "string" ? { deviceName } : {}),
        ...(typeof logId === "string" ? { logId } : {}),
        ...(typeof serverSeq === "number" ? { serverSeq } : {}),
        ...(isStringArray(kitchenDisplay) ? { kitchenDisplay } : {}),
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
      await this.replaceLog(readImportFile(file), null);
    },
    async clear() {
      await this.replaceLog([], null);
      const tx = db.transaction("meta", "readwrite", STRICT);
      await Promise.all([
        tx.store.delete("lastExportAt"),
        tx.store.delete("persisted"),
        tx.done,
      ]);
    },
    async replaceLog(events, logId) {
      const tx = db.transaction(["events", "meta"], "readwrite", STRICT);
      const eventStore = tx.objectStore("events");
      const meta = tx.objectStore("meta");
      await Promise.all([
        eventStore.clear(),
        ...events.map((event) => eventStore.add(event)),
        meta.put(FORMAT_VERSION, "formatVersion"),
        ...(logId === null
          ? [meta.delete("logId"), meta.delete("serverSeq")]
          : [
              meta.put(logId, "logId"),
              meta.put(events.at(-1)?.seq ?? 0, "serverSeq"),
            ]),
        tx.done,
      ]);
    },
    async recordFromServer(events, logId, serverSeq) {
      const tx = db.transaction(["events", "meta"], "readwrite", STRICT);
      const eventStore = tx.objectStore("events");
      const meta = tx.objectStore("meta");
      await Promise.all([
        ...events.map((event) => eventStore.add(event)),
        meta.put(logId, "logId"),
        meta.put(serverSeq, "serverSeq"),
        tx.done,
      ]);
    },
    async saveSettings(settings) {
      const tx = db.transaction("meta", "readwrite", STRICT);
      await Promise.all([
        tx.store.put(settings.serverAddress, "serverAddress"),
        tx.store.put(settings.pairingCode, "pairingCode"),
        tx.store.put(settings.deviceName, "deviceName"),
        tx.done,
      ]);
    },
    async clearServerAddress() {
      await db.delete("meta", "serverAddress");
    },
    async saveKitchenDisplay(productSelection) {
      await db.put("meta", [...productSelection], "kitchenDisplay");
    },
    async endKitchenDisplay() {
      await db.delete("meta", "kitchenDisplay");
    },
    close() {
      db.close();
    },
  };
}

/**
 * The events of an export file, checked by the same rule as at launch: a file this build can't
 * read never replaces the log. Throws `ImportRejectedError`.
 */
export function readImportFile(file: unknown): readonly Event[] {
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
  return readableEvents(file.events);
}

/** Checks events about to replace a log; throws `ImportRejectedError`. */
export function readableEvents(events: readonly unknown[]): readonly Event[] {
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

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
