import { useState } from "react";
import { cx } from "./cx";
import { ModalDialog } from "./ModalDialog";
import styles from "./ServerSection.module.css";
import shared from "./shared.module.css";

/**
 * A button on its own row that sends to the transmitter, after staff confirm `question` unless it
 * is `null`, and shows `busyLabel` while the send is in flight. The dialog sits beside the row,
 * not in it, so an open dialog doesn't change how the row lays out its button.
 */
export function ConfirmedSendButton({
  label,
  busyLabel,
  question,
  onSend,
}: {
  label: string;
  busyLabel: string;
  question: string | null;
  onSend: () => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  // The question as asked at the tap, so orders another iPad closes or opens meanwhile neither
  // change nor hide it, nor bring it back unasked (#33).
  const [asked, setAsked] = useState<string | null>(null);

  function send(): void {
    setAsked(null);
    setSending(true);
    void onSend().finally(() => {
      setSending(false);
    });
  }

  return (
    <>
      <div className={cx(shared.row, styles.buttons)}>
        <button
          type="button"
          disabled={sending}
          onClick={() => {
            if (question === null) {
              send();
            } else {
              setAsked(question);
            }
          }}
        >
          {sending ? busyLabel : label}
        </button>
      </div>
      {asked !== null && (
        <ModalDialog
          title={label}
          onClose={() => {
            setAsked(null);
          }}
        >
          <p>{asked}</p>
          <div className={shared.row}>
            <button type="button" className={shared.primary} onClick={send}>
              {label}
            </button>
            <button
              type="button"
              onClick={() => {
                setAsked(null);
              }}
            >
              Abbrechen
            </button>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
