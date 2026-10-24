import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  evaluationRows,
  headerCounts,
  kirbeShifts,
  openOrdersList,
} from "../core/index";
import type { Shift, State } from "../core/index";
import { ImportRejectedError } from "../storage/index";
import type { ReplaceResult } from "../storage/index";
import { cx } from "./cx";
import { exportLog, readExportFile } from "./export-log";
import { formatClock, formatSince } from "./format";
import { AuswahlDialog } from "./KitchenDisplay";
import { LongPressButton } from "./LongPressButton";
import { ModalDialog } from "./ModalDialog";
import { ServerSection } from "./ServerSection";
import shared from "./shared.module.css";
import { updateRow } from "./update-row";
import type { Device } from "./use-device";
import type { PagerBoard } from "./use-pager-board";
import styles from "./Verwaltung.module.css";

type View = "main" | "auswertung" | "offen";

type Guard =
  | { readonly kind: "import"; readonly file: unknown }
  | { readonly kind: "clear" }
  | { readonly kind: "overwrite" };

const REPLACED_MEANWHILE = "Das Protokoll wurde inzwischen ersetzt";

/**
 * The Verwaltung overlay. Opening it is harmless; the guards sit on the dangerous actions. In
 * `recovery`, the stored log can't be read and only export and import are offered.
 */
export function Verwaltung({
  mode,
  board,
  device,
  onBack,
  showToast,
}: {
  mode: "full" | "recovery";
  board: PagerBoard;
  device: Device;
  onBack?: () => void;
  showToast: (text: string) => void;
}) {
  const { state, meta, store, connection } = board;
  const onRefreshMeta = board.refreshMeta;
  const synced = connection !== "standalone";
  // In sync mode the replacements act on the server, so they need a working connection.
  const replaceEnabled = board.actionsEnabled;
  const [view, setView] = useState<View>("main");
  const [guard, setGuard] = useState<Guard | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [choosingKitchenDisplay, setChoosingKitchenDisplay] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const eventCount = meta?.eventCount ?? 0;
  const versionRow = updateRow(
    device.updateCheck,
    device.updateWaiting,
    device.waitingVersion,
  );

  // The counts the guards name must be current, not as of the last launch or export.
  useEffect(() => {
    void onRefreshMeta();
  }, [onRefreshMeta, guard]);

  async function runExport(): Promise<boolean> {
    if (store === null) {
      return false;
    }
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
    let result: ReplaceResult;
    try {
      result = await board.importLog(file);
    } catch (error) {
      setImportError(
        error instanceof ImportRejectedError
          ? error.message
          : `Import fehlgeschlagen: ${String(error)}`,
      );
      return;
    }
    setGuard(null);
    showToast(
      result.kind === "replaced" ? "Import abgeschlossen" : REPLACED_MEANWHILE,
    );
  }

  async function runReplace(
    replace: () => Promise<ReplaceResult>,
    done: string,
  ): Promise<void> {
    setGuard(null);
    try {
      const result = await replace();
      showToast(result.kind === "replaced" ? done : REPLACED_MEANWHILE);
    } catch (error) {
      showToast(`Fehler: ${String(error)}`);
    }
  }

  async function runClear(exportFirst: boolean): Promise<void> {
    if (exportFirst && !(await runExport())) {
      return;
    }
    await runReplace(board.startNewFest, "Neues Fest gestartet");
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
      {mode === "full" && (
        <ServerSection
          board={board}
          now={board.now}
          showToast={showToast}
          onOverwrite={() => {
            setGuard({ kind: "overwrite" });
          }}
        />
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
            disabled={!replaceEnabled}
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
              <button
                type="button"
                disabled={!synced}
                onClick={() => {
                  setChoosingKitchenDisplay(true);
                }}
              >
                Küchenanzeige…
                {!synced && (
                  <small className={styles.sub}>
                    Erst mit dem Server verbinden
                  </small>
                )}
              </button>
            </>
          )}
        </div>
      </section>
      {choosingKitchenDisplay && (
        <AuswahlDialog
          initial={meta?.kitchenDisplay ?? []}
          onSave={(productSelection) => {
            setChoosingKitchenDisplay(false);
            void board.saveKitchenDisplay(productSelection).then(onBack);
          }}
          onClose={() => {
            setChoosingKitchenDisplay(false);
          }}
        />
      )}

      <section className={styles.section}>
        <h2 className={shared.heading}>Version</h2>
        <div className={shared.row}>
          <span className={shared.grow}>
            Version {import.meta.env.APP_VERSION} · {versionRow.status}
          </span>
          <button
            type="button"
            className={shared.primary}
            disabled={versionRow.disabled}
            onClick={
              versionRow.action === "install"
                ? device.update
                : device.checkForUpdate
            }
          >
            {versionRow.label}
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
            {synced
              ? "Leert das Protokoll auf dem Server, alle iPads folgen. Der Server legt das alte Protokoll im Archiv ab."
              : "Leert das Protokoll, z. B. nach Testläufen. Rückgängig kann das nicht zurückholen."}
          </p>
          <button
            type="button"
            className={shared.danger}
            disabled={!replaceEnabled}
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
            {synced
              ? `Ersetzt das Protokoll auf dem Server durch die Datei, alle iPads folgen. Dieses iPad hat ${String(eventCount)} Ereignisse.`
              : `Ersetzt ${String(eventCount)} Ereignisse auf diesem Gerät durch die Datei.`}
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
      {guard?.kind === "overwrite" && (
        <ModalDialog
          title="Server überschreiben"
          onClose={() => {
            setGuard(null);
          }}
        >
          <p>
            Ersetzt die {meta?.serverSeq ?? 0} Ereignisse auf dem Server durch
            die {eventCount} Ereignisse dieses iPads. Der Server legt sein altes
            Protokoll im Archiv ab, alle iPads folgen.
          </p>
          <div className={styles.stack}>
            <LongPressButton
              onLongPress={() => {
                void runReplace(board.overwriteServer, "Server überschrieben");
              }}
            >
              Server überschreiben
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
  const [shiftId, setShiftId] = useState<string | null>(null);
  const shifts = kirbeShifts(state);
  // A replaced log may have no shifts any more; fall back to the whole Kirbe.
  const shown = shifts.find((shift) => shift.id === shiftId);
  return (
    <>
      <div className={styles.shifts}>
        <button
          type="button"
          aria-pressed={shown === undefined}
          className={cx(styles.shift, shown === undefined && styles.chosen)}
          onClick={() => {
            setShiftId(null);
          }}
        >
          Gesamt
        </button>
        {shifts.map((shift) => (
          <button
            key={shift.id}
            type="button"
            aria-pressed={shift === shown}
            className={cx(styles.shift, shift === shown && styles.chosen)}
            onClick={() => {
              setShiftId(shift.id);
            }}
          >
            {shift.label}
            <span className={styles.sub}>{plannedTimes(shift)}</span>
          </button>
        ))}
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Gericht</th>
            <th scope="col">Gemacht</th>
            <th scope="col">Ausgegeben</th>
            <th scope="col">Ø Wartezeit</th>
            <th scope="col">Ausverkauft um</th>
          </tr>
        </thead>
        <tbody>
          {evaluationRows(state, shown?.id).map((row) => (
            <tr key={row.productId}>
              <th scope="row">{row.label}</th>
              <td>{row.made}</td>
              <td>{row.handedOver}</td>
              <td>
                {row.averageWaitingTimeMs === undefined
                  ? "–"
                  : formatSince(row.averageWaitingTimeMs)}
              </td>
              <td>
                {row.soldOutSince !== undefined && `seit ${row.soldOutSince}`}
                {row.soldOutSince !== undefined &&
                  row.soldOutFirstAt !== undefined &&
                  ", "}
                {row.soldOutFirstAt !== undefined &&
                  formatClock(row.soldOutFirstAt)}
                {row.soldOutCleared && " (wieder frei)"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** "10:00–15:00", or "ab 19:00" where the plan says Ende. */
function plannedTimes(shift: Shift): string {
  return shift.endAt === undefined
    ? `ab ${formatClock(shift.startAt)}`
    : `${formatClock(shift.startAt)}–${formatClock(shift.endAt)}`;
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
