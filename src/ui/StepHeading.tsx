import styles from "./StepHeading.module.css";

/** A numbered step, so the screen shows the workflow by itself: 1 Annehmen, 2 Rufen, 3 Ausgeben. */
export function StepHeading({
  step,
  title,
  hint,
  id,
  level = 2,
}: {
  step: string;
  title: string;
  hint?: string;
  id?: string;
  /** 3 inside a dialog, whose title is the h2. */
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Heading className={styles.heading} id={id}>
      <span className={styles.badge}>{step}</span>
      <span>{title}</span>
      {hint !== undefined && <span className={styles.hint}>{hint}</span>}
    </Heading>
  );
}
