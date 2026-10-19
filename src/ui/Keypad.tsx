import { cx } from "./cx";
import styles from "./Keypad.module.css";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];
// Pagers go up to 30, so two digits are enough.
const MAX_DIGITS = 2;

/** Applies one keypad key to the typed digits. */
export function pressKey(digits: string, key: string): string {
  if (key === "C") {
    return "";
  }
  if (key === "⌫") {
    return digits.slice(0, -1);
  }
  return (digits + key).slice(-MAX_DIGITS);
}

export function Keypad({ onKey }: { onKey: (key: string) => void }) {
  return (
    <div className={styles.keypad}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={
            key === "C"
              ? "Löschen"
              : key === "⌫"
                ? "Letzte Ziffer löschen"
                : `Ziffer ${key}`
          }
          onClick={() => {
            onKey(key);
          }}
        >
          {key}
        </button>
      ))}
    </div>
  );
}

export function PagerDisplay({
  digits,
  label,
  bad = false,
}: {
  digits: string;
  label: string;
  bad?: boolean;
}) {
  return (
    <output
      className={cx(styles.display, bad && styles.bad)}
      aria-label={label}
    >
      {digits === "" ? "—" : digits}
    </output>
  );
}
