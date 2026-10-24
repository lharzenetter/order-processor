const HOUR_MS = 60 * 60_000;

export type KirbeDay = "samstag" | "sonntag" | "montag";

export interface PlannedShift {
  readonly crew: string;
  readonly day: KirbeDay;
  /** Berlin wall-clock time of day. */
  readonly startMs: number;
  /** Absent where the plan says "Ende": the shift runs until the next one starts. */
  readonly endMs?: number;
}

// The Festbetrieb plan, edited before a Fest like the menu. Weekdays, not dates: the Kirbe is
// always Samstag to Montag (decided in "Auswertung per Schicht").
export const SHIFT_PLAN: readonly PlannedShift[] = [
  { crew: "A", day: "samstag", startMs: 10 * HOUR_MS, endMs: 15 * HOUR_MS },
  { crew: "B", day: "samstag", startMs: 14 * HOUR_MS, endMs: 20 * HOUR_MS },
  { crew: "C", day: "samstag", startMs: 19 * HOUR_MS },
  { crew: "C", day: "sonntag", startMs: 10 * HOUR_MS, endMs: 15 * HOUR_MS },
  { crew: "A", day: "sonntag", startMs: 14 * HOUR_MS, endMs: 18.5 * HOUR_MS },
  { crew: "B", day: "sonntag", startMs: 15 * HOUR_MS },
  { crew: "C", day: "montag", startMs: 10 * HOUR_MS, endMs: 15 * HOUR_MS },
  { crew: "B", day: "montag", startMs: 14 * HOUR_MS, endMs: 19.5 * HOUR_MS },
  { crew: "A", day: "montag", startMs: 19 * HOUR_MS },
];
