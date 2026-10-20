import { useCallback, useEffect, useRef, useState } from "react";
import { fold, INITIAL_STATE, reduce, undoTarget } from "../core/index";
import type { Event, EventBody, State } from "../core/index";
import { openDeviceStore } from "../storage/index";
import type { DeviceStore, Meta } from "../storage/index";

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
  /** Stamps, appends and only then applies the event; resolves with the new state. */
  readonly dispatch: (body: EventBody) => Promise<State>;
  /** Undoes the newest action; resolves with its label, or `null` when there was nothing. */
  readonly undo: () => Promise<string | null>;
  readonly meta: Meta | null;
  readonly refreshMeta: () => Promise<void>;
  /** The open store, for the Verwaltung's export, import and clearing. */
  readonly store: DeviceStore | null;
  /** Reloads the log after an import or a clear, outside the event log. */
  readonly reload: () => Promise<void>;
}

/** The one hook that owns the board's state: folded from the log, changed only through it. */
export function usePagerBoard(): PagerBoard {
  const [status, setStatus] = useState<BoardStatus>({ kind: "loading" });
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [now, setNow] = useState(() => Date.now());
  const [meta, setMeta] = useState<Meta | null>(null);
  const [store, setStore] = useState<DeviceStore | null>(null);
  const stateRef = useRef<State>(INITIAL_STATE);
  const lastSeqRef = useRef(0);
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

  useEffect(() => {
    // Set by the cleanup; StrictMode mounts twice in development.
    const effect = { cancelled: false };
    void (async () => {
      try {
        const opened = await openDeviceStore();
        if (effect.cancelled) {
          opened.store.close();
          return;
        }
        setStore(opened.store);
        if (opened.status === "unreadable") {
          setMeta(await opened.store.meta());
          setStatus({ kind: "unreadable" });
          return;
        }
        await loadFrom(opened.store);
        setStatus({ kind: "ready" });
      } catch (error) {
        setStatus({ kind: "failed", message: String(error) });
      }
    })();
    return () => {
      effect.cancelled = true;
    };
  }, [loadFrom]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, RENDER_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const dispatch = useCallback(
    (body: EventBody): Promise<State> => {
      const run = queueRef.current.then(async () => {
        if (store === null) {
          throw new Error("Das Protokoll ist nicht geöffnet");
        }
        const at = Date.now();
        const event: Event = {
          ...body,
          id: crypto.randomUUID(),
          seq: lastSeqRef.current + 1,
          at,
        };
        // Reduce first: an event the reducer refuses never reaches the log.
        const next = reduce(stateRef.current, event);
        await store.append(event);
        lastSeqRef.current = event.seq;
        stateRef.current = next;
        setState(next);
        setNow(at);
        return next;
      });
      queueRef.current = run.catch(() => undefined);
      return run;
    },
    [store],
  );

  const undo = useCallback(async (): Promise<string | null> => {
    const target = undoTarget(stateRef.current);
    if (target === null) {
      return null;
    }
    await dispatch({ type: "actionUndone", targetId: target.event.id });
    return target.label;
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
  };
}

async function requestPersistence(): Promise<boolean> {
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
