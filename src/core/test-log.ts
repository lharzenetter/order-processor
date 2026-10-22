import type { Event, EventBody } from "./event";

/** Test helper: stamps event bodies like the ui does, with `at` advancing as the test says. */
export interface TestLog {
  readonly events: readonly Event[];
  /** Stamps and records one event at the current time; returns it. */
  add: (body: EventBody) => Event;
  /** Moves the clock forward. */
  wait: (ms: number) => void;
  readonly now: number;
}

export const START_AT = 1_760_000_000_000;

/** `device` is stamped on every event, as an iPad in sync mode does. */
export function testLog(options: { readonly device?: string } = {}): TestLog {
  const events: Event[] = [];
  let now = START_AT;
  return {
    events,
    add(body) {
      const seq = events.length + 1;
      const event: Event = {
        ...body,
        id: `e${String(seq)}`,
        seq,
        at: now,
        ...(options.device === undefined ? {} : { device: options.device }),
      };
      events.push(event);
      return event;
    },
    wait(ms) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}
