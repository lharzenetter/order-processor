import { useCallback, useEffect, useRef, useState } from "react";
import {
  assertNever,
  fold,
  INITIAL_STATE,
  reduce,
  undoTarget,
} from "../core/index";
import type { Event, EventBody, State } from "../core/index";
import {
  createServerLog,
  openDeviceStore,
  readImportFile,
  testServer,
} from "../storage/index";
import type {
  DecideQuestion,
  DeviceStore,
  EventLog,
  LogChange,
  Meta,
  ReplaceResult,
  ServerLog,
  ServerTest,
  SyncSettings,
} from "../storage/index";
import { followToast, nextConnection } from "./connection";
import type { Connection, RejectedReason } from "./connection";
import { submitTap } from "./submit-tap";

// The time-dependent selectors (time since a buzz, re-buzz due) stay current this way; there are
// no tick events (spec, "Selectors").
const RENDER_EVERY_MS = 1_000;

export type BoardStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  /** The stored log is of a format this build can't read: only export and import are offered. */
  | { readonly kind: "unreadable" }
  | { readonly kind: "failed"; readonly message: string };

export interface PagerBoard {
  readonly status: BoardStatus;
  readonly state: State;
  readonly now: number;
  /**
   * Stamps, appends and only then applies the event; resolves with the new state, or `null` when
   * the tap didn't count (Inzwischen geändert, or the log was replaced).
   */
  readonly dispatch: (body: EventBody) => Promise<State | null>;
  /** Undoes the newest action; resolves with its label, or `null` when there was nothing. */
  readonly undo: () => Promise<string | null>;
  readonly meta: Meta | null;
  readonly refreshMeta: () => Promise<void>;
  /** The open store: the mirror in sync mode. For the export, which works without the server. */
  readonly store: DeviceStore | null;
  /** Reloads the log from the store. */
  readonly reload: () => Promise<void>;
  readonly connection: Connection;
  readonly rejectedReason: RejectedReason | null;
  /** The connect-time question staff must answer; the board stays locked until they do. */
  readonly decide: DecideQuestion | null;
  /** A tap is on its way to the server. */
  readonly pending: boolean;
  /** When the board last stopped counting taps, for the strip's "Stand HH:MM". */
  readonly blockedSince: number | null;
  readonly certExpiresAt: number | null;
  /** Taps, Rückgängig and the replacements: standalone, or connected with no pending tap. */
  readonly actionsEnabled: boolean;
  /** Verbinden: tests the server, and only if it passes saves the settings and connects. */
  readonly connect: (settings: SyncSettings) => Promise<ServerTest>;
  /** Trennen, or Abbrechen in a connect-time dialog: back to standalone, keeping the board. */
  readonly disconnect: () => Promise<void>;
  /** Throws `ImportRejectedError` before anything changes. */
  readonly importLog: (file: unknown) => Promise<ReplaceResult>;
  readonly startNewFest: () => Promise<ReplaceResult>;
  readonly overwriteServer: () => Promise<ReplaceResult>;
  /** Server ist leer: Hochladen und verbinden. */
  readonly pushLocal: () => Promise<ReplaceResult>;
  /** Anderes Protokoll auf dem Server: Durch Server-Protokoll ersetzen. */
  readonly adoptServer: () => Promise<void>;
  /** Makes this iPad a Küchenanzeige for the product selection, or changes it. */
  readonly saveKitchenDisplay: (
    productSelection: readonly string[],
  ) => Promise<void>;
  readonly endKitchenDisplay: () => Promise<void>;
}

const REPLACED: ReplaceResult = { kind: "replaced" };

/** The one hook that owns the board's state: folded from the log, changed only through it. */
export function usePagerBoard(showToast: (text: string) => void): PagerBoard {
  const [status, setStatus] = useState<BoardStatus>({ kind: "loading" });
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [now, setNow] = useState(() => Date.now());
  const [meta, setMeta] = useState<Meta | null>(null);
  const [store, setStore] = useState<DeviceStore | null>(null);
  const [connection, setConnection] = useState<Connection>("standalone");
  const [rejectedReason, setRejectedReason] = useState<RejectedReason | null>(
    null,
  );
  const [decide, setDecide] = useState<DecideQuestion | null>(null);
  const [pending, setPending] = useState(false);
  const [blockedSince, setBlockedSince] = useState<number | null>(null);
  const [certExpiresAt, setCertExpiresAt] = useState<number | null>(null);
  const stateRef = useRef<State>(INITIAL_STATE);
  const lastSeqRef = useRef(0);
  const serverLogRef = useRef<ServerLog | null>(null);
  const connectionRef = useRef<Connection>("standalone");
  // Appends run one after another, so each event is checked against the state the previous made.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  const loadFrom = useCallback(async (opened: DeviceStore) => {
    const events = await opened.load();
    const folded = fold(events);
    stateRef.current = folded;
    lastSeqRef.current = events.at(-1)?.seq ?? 0;
    setState(folded);
    // Asked on every load, so the result is back in meta after Neues Fest starten clears it.
    await opened.recordPersisted(await requestPersistence());
    setMeta(await opened.meta());
  }, []);

  /** Applies events in `seq` order, skipping those already shown; a gap reloads the mirror. */
  const apply = useCallback(
    (events: readonly Event[], opened: DeviceStore) => {
      let next = stateRef.current;
      for (const event of events) {
        if (event.seq <= lastSeqRef.current) {
          continue;
        }
        if (event.seq !== lastSeqRef.current + 1) {
          void loadFrom(opened);
          return;
        }
        next = reduce(next, event);
        lastSeqRef.current = event.seq;
      }
      stateRef.current = next;
      setState(next);
      setNow(Date.now());
    },
    [loadFrom],
  );

  const moveConnection = useCallback(
    (change: Parameters<typeof nextConnection>[1]) => {
      const previous = connectionRef.current;
      const next = nextConnection(previous, change);
      connectionRef.current = next;
      setConnection(next);
      if (next !== previous) {
        const blocked = next === "disconnected" || next === "rejected";
        const wasBlocked =
          previous === "disconnected" || previous === "rejected";
        if (blocked && !wasBlocked) {
          setBlockedSince(Date.now());
        } else if (!blocked) {
          setBlockedSince(null);
        }
      }
    },
    [],
  );

  const startSync = useCallback(
    (opened: DeviceStore, settings: SyncSettings) => {
      const log = createServerLog({
        mirror: opened,
        settings,
        fetch: (input, init) => fetch(input, init),
        openStream: (url) => new EventSource(url),
      });
      serverLogRef.current = log;
      log.subscribe((change: LogChange) => {
        if (serverLogRef.current !== log) {
          return;
        }
        moveConnection(change);
        switch (change.kind) {
          case "appended":
            apply(change.events, opened);
            break;
          case "replaced":
            void loadFrom(opened);
            if (change.by !== undefined) {
              showToast(followToast(change.by));
            }
            break;
          case "connection":
            if (change.connection === "connected") {
              setDecide(null);
              setCertExpiresAt(log.certExpiresAt());
              void opened.meta().then(setMeta);
            }
            break;
          case "rejected":
            setRejectedReason(change.reason);
            setDecide(null);
            break;
          case "decide":
            setDecide(change.question);
            break;
          default:
            assertNever(change);
        }
      });
      setRejectedReason(null);
      moveConnection({ kind: "connect" });
      log.start();
    },
    [apply, loadFrom, moveConnection, showToast],
  );

  useEffect(() => {
    // Set by the cleanup; StrictMode mounts twice in development.
    const effect = { cancelled: false };
    // Read through a call: the opening awaits, so the flag can change between reads.
    const cancelled = () => effect.cancelled;
    void (async () => {
      try {
        const opened = await openDeviceStore();
        if (effect.cancelled) {
          opened.store.close();
          return;
        }
        setStore(opened.store);
        if (opened.status === "unreadable") {
          // An unreadable mirror keeps sync off.
          setMeta(await opened.store.meta());
          setStatus({ kind: "unreadable" });
          return;
        }
        await loadFrom(opened.store);
        setStatus({ kind: "ready" });
        const stored = await opened.store.meta();
        if (
          !cancelled() &&
          stored.serverAddress !== undefined &&
          stored.pairingCode !== undefined &&
          stored.deviceName !== undefined
        ) {
          startSync(opened.store, {
            serverAddress: stored.serverAddress,
            pairingCode: stored.pairingCode,
            deviceName: stored.deviceName,
          });
        }
      } catch (error) {
        setStatus({ kind: "failed", message: String(error) });
      }
    })();
    return () => {
      effect.cancelled = true;
      serverLogRef.current?.close();
      serverLogRef.current = null;
    };
  }, [loadFrom, startSync]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, RENDER_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const actionsEnabled =
    decide === null &&
    !pending &&
    (connection === "standalone" || connection === "connected");

  const dispatch = useCallback(
    (body: EventBody): Promise<State | null> => {
      const run = queueRef.current.then(async () => {
        if (store === null) {
          throw new Error("Das Protokoll ist nicht geöffnet");
        }
        const serverLog = serverLogRef.current;
        const log: EventLog = serverLog ?? store;
        const device =
          serverLog === null ? undefined : (await store.meta()).deviceName;
        setPending(serverLog !== null);
        try {
          const result = await submitTap(log, stateRef.current, body, {
            id: crypto.randomUUID(),
            seq: lastSeqRef.current + 1,
            ...(device === undefined ? {} : { device }),
          });
          switch (result.kind) {
            case "appended":
              apply(result.events, store);
              return stateRef.current;
            case "changed":
              apply(result.events, store);
              showToast("Inzwischen geändert");
              return null;
            case "dropped":
              return null;
            default:
              return assertNever(result);
          }
        } finally {
          setPending(false);
        }
      });
      queueRef.current = run.catch(() => undefined);
      return run;
    },
    [store, apply, showToast],
  );

  const undo = useCallback(async (): Promise<string | null> => {
    const target = undoTarget(stateRef.current);
    if (target === null) {
      return null;
    }
    const next = await dispatch({
      type: "actionUndone",
      targetId: target.event.id,
    });
    return next === null ? null : target.label;
  }, [dispatch]);

  const refreshMeta = useCallback(async () => {
    if (store !== null) {
      setMeta(await store.meta());
    }
  }, [store]);

  const reload = useCallback(async () => {
    if (store === null) {
      return;
    }
    await queueRef.current;
    await loadFrom(store);
    setStatus({ kind: "ready" });
  }, [store, loadFrom]);

  const connect = useCallback(
    async (settings: SyncSettings): Promise<ServerTest> => {
      if (store === null) {
        return { kind: "unreachable" };
      }
      const result = await testServer(settings, (input, init) =>
        fetch(input, init),
      );
      if (result.kind === "ok") {
        await store.saveSettings(settings);
        setCertExpiresAt(result.certExpiresAt);
        setMeta(await store.meta());
        startSync(store, settings);
      }
      return result;
    },
    [store, startSync],
  );

  const disconnect = useCallback(async () => {
    serverLogRef.current?.close();
    serverLogRef.current = null;
    moveConnection({ kind: "disconnect" });
    setDecide(null);
    setRejectedReason(null);
    setPending(false);
    if (store !== null) {
      await store.clearServerAddress();
      await loadFrom(store);
    }
  }, [store, loadFrom, moveConnection]);

  const replaceWith = useCallback(
    async (
      standalone: (opened: DeviceStore) => Promise<void>,
      synced: (log: ServerLog, opened: DeviceStore) => Promise<ReplaceResult>,
    ): Promise<ReplaceResult> => {
      if (store === null) {
        throw new Error("Das Protokoll ist nicht geöffnet");
      }
      await queueRef.current;
      const serverLog = serverLogRef.current;
      if (serverLog === null) {
        await standalone(store);
        await loadFrom(store);
        setStatus({ kind: "ready" });
        return REPLACED;
      }
      const result = await synced(serverLog, store);
      await loadFrom(store);
      return result;
    },
    [store, loadFrom],
  );

  const importLog = useCallback(
    (file: unknown) =>
      replaceWith(
        (opened) => opened.importFile(file),
        (log) => log.replace(readImportFile(file), "import"),
      ),
    [replaceWith],
  );

  const startNewFest = useCallback(
    () =>
      replaceWith(
        (opened) => opened.clear(),
        (log) => log.replace([], "newFest"),
      ),
    [replaceWith],
  );

  const overwriteServer = useCallback(
    () =>
      replaceWith(
        () => Promise.resolve(),
        async (log, opened) => log.replace(await opened.load(), "overwrite"),
      ),
    [replaceWith],
  );

  const pushLocal = useCallback(
    () =>
      replaceWith(
        () => Promise.resolve(),
        (log) => log.pushLocal(),
      ),
    [replaceWith],
  );

  const adoptServer = useCallback(async () => {
    await replaceWith(
      () => Promise.resolve(),
      async (log) => {
        await log.adoptServer();
        return REPLACED;
      },
    );
  }, [replaceWith]);

  const saveKitchenDisplay = useCallback(
    async (productSelection: readonly string[]) => {
      await store?.saveKitchenDisplay(productSelection);
      await refreshMeta();
    },
    [store, refreshMeta],
  );

  const endKitchenDisplay = useCallback(async () => {
    await store?.endKitchenDisplay();
    await refreshMeta();
  }, [store, refreshMeta]);

  return {
    status,
    state,
    now,
    dispatch,
    undo,
    meta,
    refreshMeta,
    store,
    reload,
    connection,
    rejectedReason,
    decide,
    pending,
    blockedSince,
    certExpiresAt,
    actionsEnabled,
    connect,
    disconnect,
    importLog,
    startNewFest,
    overwriteServer,
    pushLocal,
    adoptServer,
    saveKitchenDisplay,
    endKitchenDisplay,
  };
}

async function requestPersistence(): Promise<boolean> {
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
