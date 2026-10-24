import type { Event } from "./event";
import { SHIFT_PLAN } from "./shifts";
import type { KirbeDay } from "./shifts";
import type { State } from "./state";

const DAY_MS = 24 * 60 * 60_000;
const SATURDAY = 6;

const DAY_OFFSET: Readonly<Record<KirbeDay, number>> = {
  samstag: 0,
  sonntag: 1,
  montag: 2,
};

const DAY_SHORT: Readonly<Record<KirbeDay, string>> = {
  samstag: "Sa",
  sonntag: "So",
  montag: "Mo",
};

// The Kirbe is in Berlin whatever the iPad's clock is set to, and its weekend straddles the end
// of summer time.
const BERLIN = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

type PlannedOnCalendar = Omit<Shift, "countsFromAt" | "countsUntilAt">;

/** One planned shift on the calendar of this Kirbe. */
export interface Shift {
  /** "sa-a": stable, for the ui to remember a choice. */
  readonly id: string;
  readonly label: string;
  readonly crew: string;
  readonly day: KirbeDay;
  readonly startAt: number;
  /** Absent for an open end. */
  readonly endAt?: number;
  /** Where its Auswertung starts: the end of the shift before; absent for the Kirbe's first. */
  readonly countsFromAt?: number;
  /** Where the next shift's Auswertung starts; absent for the last. */
  readonly countsUntilAt?: number;
}

/**
 * The shifts of the Festbetrieb plan in calendar order, on the Saturday nearest to the first
 * event; none before the first event.
 */
export function kirbeShifts(state: State): readonly Shift[] {
  const first = state.live[0];
  if (first === undefined) {
    return [];
  }
  const saturday = nearestSaturday(first.at);
  const planned = SHIFT_PLAN.map((shift): PlannedOnCalendar => {
    const date = saturday + DAY_OFFSET[shift.day] * DAY_MS;
    const startAt = berlinAt(date, shift.startMs);
    const base = {
      id: `${DAY_SHORT[shift.day].toLowerCase()}-${shift.crew.toLowerCase()}`,
      label: `${DAY_SHORT[shift.day]} ${shift.crew}`,
      crew: shift.crew,
      day: shift.day,
      startAt,
    };
    return shift.endMs === undefined
      ? base
      : { ...base, endAt: berlinAt(date, shift.endMs) };
  }).sort((a, b) => a.startAt - b.startAt);
  const countsFrom = planned.map((shift, i) => {
    const before = planned[i - 1];
    return before === undefined ? undefined : (before.endAt ?? shift.startAt);
  });
  return planned.map((shift, i) => {
    const from = countsFrom[i];
    const until = countsFrom[i + 1];
    return {
      ...shift,
      ...(from === undefined ? {} : { countsFromAt: from }),
      ...(until === undefined ? {} : { countsUntilAt: until }),
    };
  });
}

/**
 * The live events a shift counts, as positions into `live`. Cut by position, not by filtering on
 * `at`, so each side is a prefix that folds; iPad clocks drifting apart only blur the cut.
 */
export function shiftRange(
  live: readonly Event[],
  shift: Shift,
): { readonly from: number; readonly until: number } {
  return {
    from:
      shift.countsFromAt === undefined ? 0 : indexAt(live, shift.countsFromAt),
    until:
      shift.countsUntilAt === undefined
        ? live.length
        : indexAt(live, shift.countsUntilAt),
  };
}

function indexAt(live: readonly Event[], at: number): number {
  const index = live.findIndex((event) => event.at >= at);
  return index === -1 ? live.length : index;
}

/** UTC midnight of the Saturday's Berlin date: Wednesday to Friday look ahead, Sunday to Tuesday back. */
function nearestSaturday(at: number): number {
  const { year, month, day } = berlinWallClock(at);
  const days = daysFromCivil(year, month, day);
  const ahead = (((SATURDAY - weekdayOf(days)) % 7) + 7) % 7;
  return (days + (ahead > 3 ? ahead - 7 : ahead)) * DAY_MS;
}

/** The instant of a Berlin wall-clock time on the date whose UTC midnight is `date`. */
function berlinAt(date: number, timeOfDayMs: number): number {
  const asUtc = date + timeOfDayMs;
  const guess = asUtc - berlinOffset(asUtc);
  return asUtc - berlinOffset(guess);
}

function berlinOffset(at: number): number {
  const wall = berlinWallClock(at);
  const wallAsUtc =
    daysFromCivil(wall.year, wall.month, wall.day) * DAY_MS +
    ((wall.hour * 60 + wall.minute) * 60 + wall.second) * 1000;
  return wallAsUtc - (at - (((at % 1000) + 1000) % 1000));
}

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil), since the core has no `Date`. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** 0 for Sunday; 1970-01-01 was a Thursday. */
function weekdayOf(days: number): number {
  return (((days + 4) % 7) + 7) % 7;
}

function berlinWallClock(at: number): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
} {
  const parts = BERLIN.formatToParts(at);
  function part(type: Intl.DateTimeFormatPartTypes): number {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) {
      throw new Error(`No ${type} in ${String(at)}`);
    }
    return Number(value);
  }
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}
