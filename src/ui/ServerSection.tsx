import { useState } from "react";
import { cx } from "./cx";
import type { Connection, RejectedReason } from "./connection";
import { connectionLabel } from "./connection";
import {
  CERT_WARN_DAYS,
  certDaysLeft,
  deviceNameProblem,
  isServerAddress,
  serverTestText,
} from "./server-settings";
import styles from "./ServerSection.module.css";
import shared from "./shared.module.css";
import type { PagerBoard } from "./use-pager-board";

/** The Verwaltung's first section: connect this iPad to the server, or work standalone. */
export function ServerSection({
  board,
  now,
  showToast,
  onOverwrite,
}: {
  board: PagerBoard;
  now: number;
  showToast: (text: string) => void;
  onOverwrite: () => void;
}) {
  const { meta, connection, rejectedReason, certExpiresAt } = board;
  const standalone = connection === "standalone";
  const [address, setAddress] = useState(meta?.serverAddress ?? "");
  const [code, setCode] = useState(meta?.pairingCode ?? "");
  const [deviceName, setDeviceName] = useState(meta?.deviceName ?? "");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const nameProblem = deviceNameProblem(deviceName);
  const canConnect =
    isServerAddress(address.trim()) &&
    code.trim() !== "" &&
    nameProblem === null;
  const daysLeft =
    certExpiresAt === null ? null : certDaysLeft(certExpiresAt, now);

  async function connect(): Promise<void> {
    setTesting(true);
    setResult(null);
    try {
      const tested = await board.connect({
        serverAddress: address.trim(),
        pairingCode: code.trim(),
        deviceName: deviceName.trim(),
      });
      setResult(serverTestText(tested));
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className={styles.section} aria-label="Server">
      <h2 className={shared.heading}>Server</h2>
      <p className={styles.status}>
        {statusText(connection, rejectedReason, meta?.deviceName ?? deviceName)}
        {!standalone && ` · ${meta?.serverAddress ?? address}`}
        {!standalone &&
          daysLeft !== null &&
          ` · Zertifikat noch ${String(daysLeft)} Tage gültig`}
      </p>
      {!standalone && daysLeft !== null && daysLeft < CERT_WARN_DAYS && (
        <p className={styles.warning} role="alert">
          Zertifikat läuft in {daysLeft} Tagen ab — vor dem nächsten Fest
          erneuern.
        </p>
      )}
      <div className={styles.fields}>
        <label className={styles.field}>
          Adresse
          <input
            value={standalone ? address : (meta?.serverAddress ?? address)}
            readOnly={!standalone}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setAddress(event.target.value);
            }}
          />
          <small className={shared.muted}>ohne https://</small>
        </label>
        <label className={styles.field}>
          Kopplungscode
          <input
            value={code}
            readOnly={!standalone}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
          <small className={shared.muted}>8 Zeichen</small>
        </label>
        <label className={styles.field}>
          Gerätename
          <input
            value={deviceName}
            readOnly={!standalone}
            onChange={(event) => {
              setDeviceName(event.target.value);
            }}
          />
          {nameProblem !== null ? (
            <small className={styles.problem}>{nameProblem}</small>
          ) : (
            <small className={shared.muted}>
              Jedes iPad einen eigenen, z. B. „Annahme“
            </small>
          )}
        </label>
      </div>
      <div className={cx(shared.row, styles.buttons)}>
        {standalone ? (
          <>
            <button
              type="button"
              className={shared.primary}
              disabled={!canConnect || testing}
              onClick={() => {
                void connect();
              }}
            >
              {testing ? "Teste Verbindung…" : "Verbinden"}
            </button>
            {result !== null && (
              <span className={styles.result} role="status">
                {result}
              </span>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className={shared.danger}
              onClick={() => {
                void board.disconnect().then(() => {
                  setResult(null);
                  showToast(
                    "Getrennt — dieses iPad arbeitet eigenständig weiter",
                  );
                });
              }}
            >
              Trennen
            </button>
            <button
              type="button"
              className={shared.link}
              disabled={connection !== "connected" || !board.actionsEnabled}
              onClick={onOverwrite}
            >
              Server mit diesem iPad überschreiben…
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function statusText(
  connection: Connection,
  rejectedReason: RejectedReason | null,
  deviceName: string,
): string {
  return connectionLabel(connection, rejectedReason, deviceName).replace(
    /^[●○] /,
    "",
  );
}
