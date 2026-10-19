import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Toasts.module.css";

const TOAST_MS = 4_000;

interface Toast {
  readonly id: number;
  readonly text: string;
}

export function useToasts(): {
  readonly toasts: readonly Toast[];
  readonly showToast: (text: string) => void;
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

  const showToast = useCallback((text: string) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { id, text }]);
    timers.current.push(
      window.setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, TOAST_MS),
    );
  }, []);

  return { toasts, showToast };
}

export function Toasts({ toasts }: { toasts: readonly Toast[] }) {
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={styles.toast}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
