import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "./cx";
import styles from "./Toasts.module.css";

const TOAST_MS = 4_000;

/** Only a toast that stays carries an action: one that goes away by itself has no button. */
export type ToastOptions =
  | { readonly stays?: false }
  | {
      /** Stays until tapped away instead of going away by itself. */
      readonly stays: true;
      /** A button on the toast; tapping it also takes the toast away. */
      readonly action?: { readonly label: string; readonly run: () => void };
    };

type Toast = ToastOptions & {
  readonly id: number;
  readonly text: string;
};

export type ShowToast = (text: string, options?: ToastOptions) => void;

export function useToasts(): {
  readonly toasts: readonly Toast[];
  readonly showToast: ShowToast;
  readonly dismissToast: (id: number) => void;
} {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        clearTimeout(timer);
      }
    },
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (text: string, options: ToastOptions = {}) => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current, { id, text, ...options }]);
      if (options.stays !== true) {
        timers.current.push(
          window.setTimeout(() => {
            dismissToast(id);
          }, TOAST_MS),
        );
      }
    },
    [dismissToast],
  );

  return { toasts, showToast, dismissToast };
}

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: readonly Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((toast) =>
        toast.stays === true ? (
          <div key={toast.id} className={cx(styles.toast, styles.staying)}>
            <button
              type="button"
              className={styles.dismiss}
              aria-label={`${toast.text} – schließen`}
              onClick={() => {
                onDismiss(toast.id);
              }}
            >
              {toast.text} <span aria-hidden="true">✕</span>
            </button>
            {toast.action !== undefined && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  onDismiss(toast.id);
                  toast.action?.run();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ) : (
          <div key={toast.id} className={styles.toast}>
            {toast.text}
          </div>
        ),
      )}
    </div>
  );
}
