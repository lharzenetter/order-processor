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

/**
 * The Verwaltung's transmitter check in sync mode: its status, a Testruf that records nothing, and
 * the Pager automatisch rufen switch for every iPad. Status and Testruf work with the switch off.
 */
export function TransmitterSection({
  connected,
  onTestCall,
  pagerCallsOn,
  switchEnabled,
  onSwitchPagerCalls,
}: {
  connected: boolean | null;
  onTestCall: (pager: number) => Promise<void>;
  pagerCallsOn: boolean;
  /** The switch is recorded, so like every tap it needs the server to count it. */
  switchEnabled: boolean;
  onSwitchPagerCalls: (on: boolean) => void;
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
      <label className={styles.toggle}>
        <input
          type="checkbox"
          role="switch"
          checked={pagerCallsOn}
          disabled={!switchEnabled}
          onChange={(event) => {
            onSwitchPagerCalls(event.target.checked);
          }}
        />
        Pager automatisch rufen
        <small className={shared.muted}>
          {pagerCallsOn
            ? "Rufen, Nochmal rufen und Weitergeben rufen den Pager, auf allen iPads."
            : "Aus auf allen iPads: Pager von Hand am Sender rufen."}
        </small>
      </label>
    </section>
  );
}
