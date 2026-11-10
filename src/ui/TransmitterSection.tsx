import { useState } from "react";
import { PAGER_COUNT } from "../core/index";
import { cx } from "./cx";
import styles from "./ServerSection.module.css";
import shared from "./shared.module.css";

/** The pager number typed for a Testruf, or `null` while it names no pager. */
function testCallPager(digits: string): number | null {
  if (!/^\d+$/.test(digits.trim())) {
    return null;
  }
  const pager = Number(digits.trim());
  return pager >= 1 && pager <= PAGER_COUNT ? pager : null;
}

function statusText(connected: boolean | null): string {
  if (connected === null) {
    return "Sender wird geprüft…";
  }
  return connected ? "● Sender verbunden" : "○ Sender nicht verbunden";
}

/** The Verwaltung's transmitter check in sync mode: its status, and a Testruf that records nothing. */
export function TransmitterSection({
  connected,
  onTestCall,
}: {
  connected: boolean | null;
  onTestCall: (pager: number) => Promise<void>;
}) {
  const [digits, setDigits] = useState("");
  const [calling, setCalling] = useState(false);
  const pager = testCallPager(digits);

  return (
    <section className={styles.section} aria-label="Sender">
      <h2 className={shared.heading}>Sender</h2>
      <p className={styles.status}>{statusText(connected)}</p>
      <div className={cx(shared.row, styles.buttons)}>
        <label className={styles.field}>
          Testruf an Pager
          <input
            value={digits}
            inputMode="numeric"
            autoComplete="off"
            onChange={(event) => {
              setDigits(event.target.value);
            }}
          />
          <small className={shared.muted}>1–{PAGER_COUNT}</small>
        </label>
        <button
          type="button"
          className={shared.primary}
          disabled={pager === null || calling}
          onClick={() => {
            if (pager === null) {
              return;
            }
            setCalling(true);
            void onTestCall(pager).finally(() => {
              setCalling(false);
            });
          }}
        >
          {calling ? "Rufe…" : "Rufen"}
        </button>
      </div>
    </section>
  );
}
