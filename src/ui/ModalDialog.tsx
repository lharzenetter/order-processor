import { useEffect, useRef } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { cx } from "./cx";
import styles from "./ModalDialog.module.css";

// A native modal <dialog>: it keeps focus inside, makes the rest of the page inert, and stacks
// above an open dialog (the sold-out confirmation above the intake).
export function ModalDialog({
  title,
  heading = title,
  size = "normal",
  onClose,
  children,
}: {
  /** The accessible name. */
  title: string;
  /** What the dialog shows as its heading; defaults to the title. */
  heading?: ReactNode;
  size?: "normal" | "wide" | "big";
  /** Called on Escape and on a tap outside the dialog; without it, neither closes it. */
  onClose?: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>): void {
    event.preventDefault();
    onClose?.();
  }

  function handleClick(event: SyntheticEvent<HTMLDialogElement>): void {
    // A tap on the backdrop lands on the <dialog> itself.
    if (event.target === dialogRef.current) {
      onClose?.();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={cx(styles.dialog, styles[size])}
      aria-label={title}
      onCancel={handleCancel}
      onClick={handleClick}
    >
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{heading}</h2>
        {onClose !== undefined && size !== "big" && (
          <button
            type="button"
            className={styles.close}
            aria-label="Fenster schließen"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
