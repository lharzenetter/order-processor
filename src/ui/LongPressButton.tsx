import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./LongPressButton.module.css";

// Keep in step with the fill transition in LongPressButton.module.css.
const HOLD_MS = 1_500;

/** A button for a destructive action: it fires only after being held, never on a plain tap. */
export function LongPressButton({
  onLongPress,
  children,
}: {
  onLongPress: () => void;
  children: ReactNode;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

  function cancel(): void {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  }

  useEffect(() => cancel, []);

  return (
    <button
      type="button"
      className={cx(styles.button, holding && styles.holding)}
      onPointerDown={() => {
        setHolding(true);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setHolding(false);
          onLongPress();
        }, HOLD_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      <span className={styles.fill} />
      <span className={styles.label}>
        {children}
        <small> (lange drücken)</small>
      </span>
    </button>
  );
}
