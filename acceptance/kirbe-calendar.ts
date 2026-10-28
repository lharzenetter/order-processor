import type { KirbeDay } from "../src/core";
import type { Duration, KirbeDayName } from "./window";

export function msOf({ minutes = 0, seconds = 0 }: Duration): number {
  return (minutes * 60 + seconds) * 1000;
}

/** "4:05", as the buzzed list's clock reads; the screen drops part-seconds. */
export function clockOf(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

// This Kirbe runs Samstag 24. to Montag 26. Oktober 2026, so its Sunday night has the end of summer
// time, as the shift tests in the core have.
const KIRBE_SATURDAY = { year: 2026, month: 10, day: 24 } as const;

const DAY_OFFSET: Readonly<Record<KirbeDayName, number>> = {
  Samstag: 0,
  Sonntag: 1,
  Montag: 2,
};

export const CORE_DAY: Readonly<Record<KirbeDayName, KirbeDay>> = {
  Samstag: "samstag",
  Sonntag: "sonntag",
  Montag: "montag",
};

const HOUR_MS = 60 * 60_000;

// The Kirbe is in Berlin whatever the machine running the scenarios is set to.
const BERLIN = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  weekday: "long",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function berlinParts(at: number): Readonly<Record<string, string>> {
  return Object.fromEntries(
    BERLIN.formatToParts(at).map((part) => [part.type, part.value]),
  );
}

/** "11:30", as the Auswertung shows a time of day. */
export function berlinClock(at: number): string {
  const { hour = "", minute = "" } = berlinParts(at);
  return `${hour}:${minute}`;
}

/** "Samstag 11:30", as a scenario writes it. */
function dayAndTimeOf(at: number): string {
  return `${berlinParts(at).weekday ?? ""} ${berlinClock(at)}`;
}

function isKirbeDay(day: string): day is KirbeDayName {
  return day in DAY_OFFSET;
}

/** The instant of "Samstag 11:30" on this Kirbe's calendar; refuses an hour that is not one. */
export function kirbeAt(dayAndTime: string): number {
  const match = /^(Samstag|Sonntag|Montag) (\d{1,2}):(\d{2})$/.exec(dayAndTime);
  const [, day, hour, minute] = match ?? [];
  if (
    day === undefined ||
    !isKirbeDay(day) ||
    hour === undefined ||
    minute === undefined ||
    Number(hour) > 23 ||
    Number(minute) > 59
  ) {
    throw new Error(
      `"${dayAndTime}" is no time on the Kirbe: write a Kirbe day and a time, as in "Samstag 11:30"`,
    );
  }
  const offset = DAY_OFFSET[day];
  // Berlin is two hours ahead in summer time and one in winter time; keep what reads back right.
  const candidates = [2, 1]
    .map(
      (ahead) =>
        Date.UTC(
          KIRBE_SATURDAY.year,
          KIRBE_SATURDAY.month - 1,
          KIRBE_SATURDAY.day + offset,
          Number(hour),
          Number(minute),
        ) -
        ahead * HOUR_MS,
    )
    .filter(
      (at) => dayAndTimeOf(at) === `${day} ${hour.padStart(2, "0")}:${minute}`,
    );
  const [at, twice] = candidates;
  if (at === undefined) {
    throw new Error(`"${dayAndTime}" never happens: the clocks skip that hour`);
  }
  if (twice !== undefined) {
    throw new Error(
      `"${dayAndTime}" happens twice: the clocks go back from 03:00 to 02:00 that night`,
    );
  }
  return at;
}

// Every scenario starts when the Kirbe opens (#8).
export const START_AT = kirbeAt("Samstag 10:00");

/** The instant once `duration` has passed since `now`; time only moves forward (#8). */
export function passing(now: number, duration: Duration): number {
  const ms = msOf(duration);
  if (ms <= 0) {
    throw new Error(
      `time only moves forward: ${String(duration.minutes ?? 0)} minutes and ${String(duration.seconds ?? 0)} seconds cannot pass`,
    );
  }
  return now + ms;
}

/** The instant of "Samstag 11:30", which must not lie before `now` (#8). */
export function movingTo(now: number, dayAndTime: string): number {
  const at = kirbeAt(dayAndTime);
  if (at < now) {
    throw new Error(
      `time only moves forward: it is ${dayAndTimeOf(now)} already, past ${dayAndTime}`,
    );
  }
  return at;
}
