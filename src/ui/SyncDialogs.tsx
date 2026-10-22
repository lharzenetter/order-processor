import { useState } from "react";
import type { DecideQuestion, DeviceStore } from "../storage/index";
import { exportLog } from "./export-log";
import { ModalDialog } from "./ModalDialog";
import shared from "./shared.module.css";
import styles from "./SyncDialogs.module.css";

/** The connect-time question; the board stays locked until staff answer it. */
export function DecideDialog({
  question,
  store,
  onPush,
  onAdopt,
  onCancel,
}: {
  question: DecideQuestion;
  store: DeviceStore;
  onPush: () => void;
  onAdopt: () => void;
  onCancel: () => void;
}) {
  const [exported, setExported] = useState(false);
  if (question.kind === "serverEmpty") {
    return (
      <ModalDialog title="Server ist leer">
        <p>
          Auf dem Server ist noch nichts. Dieses iPad hat {question.localCount}{" "}
          Ereignisse. Hochladen, damit alle iPads damit weiterarbeiten?
        </p>
        <div className={styles.stack}>
          <button type="button" className={shared.primary} onClick={onPush}>
            Hochladen und verbinden
          </button>
          <button type="button" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </ModalDialog>
    );
  }
  // Tapping outside doesn't dismiss it: without onClose, ModalDialog ignores the backdrop.
  return (
    <ModalDialog title="Anderes Protokoll auf dem Server">
      <p>
        Auf dem Server liegt ein anderes Protokoll mit {question.serverCount}{" "}
        Ereignissen. Dieses iPad hat {question.localCount} Ereignisse und
        übernimmt das Protokoll des Servers. Vorher die eigenen Ereignisse
        exportieren.
      </p>
      <div className={styles.stack}>
        <button
          type="button"
          className={exported ? shared.secondary : shared.primary}
          disabled={exported}
          onClick={() => {
            void exportLog(store).then(setExported);
          }}
        >
          {exported ? "✓ Exportiert" : "1. Exportieren"}
        </button>
        <button
          type="button"
          className={shared.primary}
          disabled={!exported}
          onClick={onAdopt}
        >
          2. Durch Server-Protokoll ersetzen
        </button>
        <button type="button" onClick={onCancel}>
          Abbrechen — eigenständig bleiben
        </button>
      </div>
    </ModalDialog>
  );
}
