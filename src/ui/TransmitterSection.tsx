import { useState } from "react";
import { PAGER_COUNT } from "../core/index";
import { cx } from "./cx";
import { groupCallQuestion } from "./group-call";
import { ModalDialog } from "./ModalDialog";
import { powerOffQuestion } from "./power-off";
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
 * The Verwaltung's transmitter check in sync mode: its status, a Testruf, the group call and the
 * power-off, which record nothing, and the Pager automatisch rufen switch for every iPad. All but
 * the switch work with the switch off.
 */
export function TransmitterSection({
  connected,
  onTestCall,
  openOrders,
  onGroupCall,
  onPowerOff,
  pagerCallsOn,
  switchEnabled,
  onSwitchPagerCalls,
}: {
  connected: boolean | null;
  onTestCall: (pager: number) => Promise<void>;
  openOrders: number;
  onGroupCall: () => Promise<void>;
  onPowerOff: () => Promise<void>;
  pagerCallsOn: boolean;
  /** The switch is recorded, so like every tap it needs the server to count it. */
  switchEnabled: boolean;
  onSwitchPagerCalls: (on: boolean) => void;
}) {
  const [digits, setDigits] = useState("");
  const [calling, setCalling] = useState(false);
  const [groupCalling, setGroupCalling] = useState(false);
  const [confirmingGroupCall, setConfirmingGroupCall] = useState(false);
  const [poweringOff, setPoweringOff] = useState(false);
  const [confirmingPowerOff, setConfirmingPowerOff] = useState(false);
  const pager = testCallPager(digits);
  const groupCallAsks = groupCallQuestion(openOrders);

  function sendGroupCall(): void {
    setConfirmingGroupCall(false);
    setGroupCalling(true);
    void onGroupCall().finally(() => {
      setGroupCalling(false);
    });
  }

  function sendPowerOff(): void {
    setConfirmingPowerOff(false);
    setPoweringOff(true);
    void onPowerOff().finally(() => {
      setPoweringOff(false);
    });
  }

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
      <div className={cx(shared.row, styles.buttons)}>
        <button
          type="button"
          disabled={groupCalling}
          onClick={() => {
            if (groupCallAsks === null) {
              sendGroupCall();
            } else {
              setConfirmingGroupCall(true);
            }
          }}
        >
          {groupCalling ? "Rufe alle Pager…" : "Alle Pager rufen"}
        </button>
      </div>
      {confirmingGroupCall && groupCallAsks !== null && (
        <ModalDialog
          title="Alle Pager rufen"
          onClose={() => {
            setConfirmingGroupCall(false);
          }}
        >
          <p>{groupCallAsks}</p>
          <div className={shared.row}>
            <button
              type="button"
              className={shared.primary}
              onClick={sendGroupCall}
            >
              Alle Pager rufen
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingGroupCall(false);
              }}
            >
              Abbrechen
            </button>
          </div>
        </ModalDialog>
      )}
      <div className={cx(shared.row, styles.buttons)}>
        <button
          type="button"
          disabled={poweringOff}
          onClick={() => {
            setConfirmingPowerOff(true);
          }}
        >
          {poweringOff ? "Schalte alle Pager aus…" : "Alle Pager ausschalten"}
        </button>
      </div>
      {confirmingPowerOff && (
        <ModalDialog
          title="Alle Pager ausschalten"
          onClose={() => {
            setConfirmingPowerOff(false);
          }}
        >
          <p>{powerOffQuestion(openOrders)}</p>
          <div className={shared.row}>
            <button
              type="button"
              className={shared.primary}
              onClick={sendPowerOff}
            >
              Alle Pager ausschalten
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingPowerOff(false);
              }}
            >
              Abbrechen
            </button>
          </div>
        </ModalDialog>
      )}
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
