import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { evaluationRows, headerCounts, openOrdersList } from "../core/index";
import type { State } from "../core/index";
import { ImportRejectedError } from "../storage/index";
import type { DeviceStore, Meta } from "../storage/index";
import { cx } from "./cx";
import { exportLog, readExportFile } from "./export-log";
import { formatClock } from "./format";
import { LongPressButton } from "./LongPressButton";
import { ModalDialog } from "./ModalDialog";
import shared from "./shared.module.css";
import type { Device } from "./use-device";
import styles from "./Verwaltung.module.css";

type View = "main" | "auswertung" | "offen";

type Guard =
  | { readonly kind: "import"; readonly file: unknown }
  | { readonly kind: "clear" };

/**
 * The Verwaltung overlay. Opening it is harmless; the guards sit on the dangerous actions. In
 * `recovery`, the stored log can't be read and only export and import are offered.
 */
export function Verwaltung({
  mode,
  state,
  meta,
  store,
  device,
  onBack,
  onReload,
  onRefreshMeta,
  showToast,
}: {
  mode: "full" | "recovery";
  state: State;
  meta: Meta | null;
  store: DeviceStore;
  device: Device;
  onBack?: () => void;
  onReload: () => Promise<void>;
  onRefreshMeta: () => Promise<void>;
  showToast: (text: string) => void;
}) {
  const [view, setView] = useState<View>("main");
  const [guard, setGuard] = useState<Guard | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const eventCount = meta?.eventCount ?? 0;

  // The counts the guards name must be current, not as of the last launch or export.
  useEffect(() => {
    void onRefreshMeta();
  }, [onRefreshMeta, guard]);

  async function runExport(): Promise<boolean> {
    try {
      const done = await exportLog(store);
      await onRefreshMeta();
      return done;
    } catch (error) {
      showToast(`Export fehlgeschlagen: ${String(error)}`);
      return false;
    }
  }

  async function runImport(file: unknown, exportFirst: boolean): Promise<void> {
    if (exportFirst && !(await runExport())) {
      return;
    }
    try {
      await store.importFile(file);
    } catch (error) {
      setImportError(
        error instanceof ImportRejectedError
          ? error.message
          : `Import fehlgeschlagen: ${String(error)}`,
      );
      return;
    }
    setGuard(null);
    await onReload();
    showToast("Import abgeschlossen");
  }

  async function runClear(exportFirst: boolean): Promise<void> {
    if (exportFirst && !(await runExport())) {
      return;
    }
    await store.clear();
    setGuard(null);
    await onReload();
    showToast("Neues Fest gestartet");
  }

  if (view !== "main") {
    return (
      <Overlay
        title={view === "auswertung" ? "Auswertung" : "Offene Bestellungen"}
        onBack={() => {
          setView("main");
        }}
      >
        {view === "auswertung" ? (
          <Auswertung state={state} />
        ) : (
          <OffeneBestellungen state={state} />
        )}
      </Overlay>
    );
  }

  return (
    <Overlay title="Verwaltung" {...(onBack === undefined ? {} : { onBack })}>
      {mode === "recovery" && (
        <p className={styles.recovery} role="alert">
          Diese Version kann das gespeicherte Protokoll nicht lesen. Es bleibt
          unverändert. Bitte exportieren und auf einem passenden Gerät oder nach
          einem Update wieder importieren.
        </p>
      )}
      <section className={styles.section}>
        <h2 className={shared.heading}>Aktionen</h2>
        <div className={styles.actions}>
          <button
            type="button"
            className={shared.primary}
            onClick={() => {
              void runExport();
            }}
          >
            Exportieren
            <small className={styles.sub}>
              Letzter Export:{" "}
              {meta?.lastExportAt === undefined
                ? "noch nie"
                : formatClock(meta.lastExportAt)}
            </small>
          </button>
          <button
            type="button"
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            Importieren
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Export-Datei wählen"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (chosen !== undefined) {
                void readExportFile(chosen).then((file) => {
                  setImportError(null);
                  setGuard({ kind: "import", file });
                });
              }
            }}
          />
          {mode === "full" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setView("auswertung");
                }}
              >
                Auswertung
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("offen");
                }}
              >
                Offene Bestellungen
              </button>
            </>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={shared.heading}>Version</h2>
        <div className={shared.row}>
          <span className={shared.grow}>
            Version {import.meta.env.APP_VERSION} ·{" "}
            {device.updateWaiting ? "Neue Version bereit" : "Aktuell"}
          </span>
          <button
            type="button"
            className={shared.go}
            disabled={!device.updateWaiting}
            onClick={device.update}
          >
            Aktualisieren
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={shared.heading}>Zustand</h2>
        <ul className={styles.health}>
          <HealthLine ok={device.standalone}>
            Vom Home-Bildschirm gestartet
          </HealthLine>
          <HealthLine ok={meta?.persisted === true}>
            Speicher dauerhaft
          </HealthLine>
          <HealthLine ok={device.wakeLockHeld}>
            Bildschirm bleibt an
            {!device.wakeLockSupported && " (nicht unterstützt)"}
          </HealthLine>
          <HealthLine ok>Ereignisse im Protokoll: {eventCount}</HealthLine>
        </ul>
      </section>

      {mode === "full" && (
        <section className={cx(styles.section, styles.danger)}>
          <h2 className={shared.heading}>Neues Fest starten</h2>
          <p className={shared.muted}>
            Leert das Protokoll, z. B. nach Testläufen. Rückgängig kann das
            nicht zurückholen.
          </p>
          <button
            type="button"
            className={shared.danger}
            onClick={() => {
              setGuard({ kind: "clear" });
            }}
          >
            Neues Fest starten…
          </button>
        </section>
      )}

      {guard?.kind === "import" && (
        <ModalDialog
          title="Importieren"
          onClose={() => {
            setGuard(null);
          }}
        >
          <p>
            Ersetzt {eventCount} Ereignisse auf diesem Gerät durch die Datei.
          </p>
          {importError !== null && (
            <p className={styles.error} role="alert">
              {importError}
            </p>
          )}
          <div className={styles.stack}>
            <button
              type="button"
              className={shared.primary}
              onClick={() => {
                void runImport(guard.file, true);
              }}
            >
              Exportieren und importieren
            </button>
            <LongPressButton
              onLongPress={() => {
                void runImport(guard.file, false);
              }}
            >
              Ohne Export importieren
            </LongPressButton>
            <button
              type="button"
              onClick={() => {
                setGuard(null);
              }}
            >
              Abbrechen
            </button>
          </div>
        </ModalDialog>
      )}

      {guard?.kind === "clear" && (
        <ModalDialog
          title="Neues Fest starten"
          onClose={() => {
            setGuard(null);
          }}
        >
          <p>
            Weg sind dann: {eventCount} Ereignisse,{" "}
            {headerCounts(state).openOrders} offene Bestellungen.
          </p>
          <div className={styles.stack}>
            <button
              type="button"
              className={shared.primary}
              onClick={() => {
                void runClear(true);
              }}
            >
              Exportieren und leeren
            </button>
            <LongPressButton
              onLongPress={() => {
                void runClear(false);
              }}
            >
              Ohne Export leeren
            </LongPressButton>
            <button
              type="button"
              onClick={() => {
                setGuard(null);
              }}
            >
              Abbrechen
            </button>
          </div>
        </ModalDialog>
      )}
    </Overlay>
  );
}

function Overlay({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.overlay} role="region" aria-label={title}>
      <div className={styles.top}>
        {onBack !== undefined && (
          <button type="button" className={styles.back} onClick={onBack}>
            ← Zurück
          </button>
        )}
        <h1 className={styles.title}>{title}</h1>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}

function HealthLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={ok ? styles.ok : styles.bad}>
      <span aria-hidden="true">●</span> {children}
      <span className={styles.visuallyHidden}>{ok ? ": ja" : ": nein"}</span>
    </li>
  );
}

function Auswertung({ state }: { state: State }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Gericht</th>
          <th scope="col">Gemacht</th>
          <th scope="col">Ausgegeben</th>
          <th scope="col">Ausverkauft um</th>
        </tr>
      </thead>
      <tbody>
        {evaluationRows(state).map((row) => (
          <tr key={row.productId}>
            <th scope="row">{row.label}</th>
            <td>{row.made}</td>
            <td>{row.handedOver}</td>
            <td>
              {row.soldOutFirstAt !== undefined &&
                formatClock(row.soldOutFirstAt)}
              {row.soldOutCleared && " (wieder frei)"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OffeneBestellungen({ state }: { state: State }) {
  const entries = openOrdersList(state);
  if (entries.length === 0) {
    return <p className={styles.paper}>Keine offenen Bestellungen.</p>;
  }
  return (
    <ul className={styles.paper}>
      {entries.map((entry) => (
        <li key={entry.orderId}>
          <b>Pager {entry.pager}:</b>{" "}
          {entry.lines
            .map(
              (line) =>
                `${String(line.owed)}× ${line.label}${line.buzzed > 0 ? ` (${String(line.buzzed)} gerufen)` : ""}`,
            )
            .join(", ")}
        </li>
      ))}
    </ul>
  );
}
