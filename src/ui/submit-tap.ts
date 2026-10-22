import { assertNever, reduce } from "../core/index";
import type { Event, EventBody, State } from "../core/index";
import type { EventLog } from "../storage/index";

// server-sync 02: after the third lost race, the tap gives up.
export const MAX_ROUNDS = 3;

export type TapResult =
  /** `events` are what to apply, in order: what others appended first, then the tap. */
  | { readonly kind: "appended"; readonly events: readonly Event[] }
  /** Inzwischen geändert: the tap no longer applies; `events` are what others appended. */
  | { readonly kind: "changed"; readonly events: readonly Event[] }
  /** The log was replaced or left; the tap never counted. */
  | { readonly kind: "dropped" };

/**
 * Appends one tap, re-checking it against what other iPads appended first: same id, next seq,
 * fresh `at`. Storage reports the race; the domain rule is decided here.
 */
export async function submitTap(
  log: EventLog,
  state: State,
  body: EventBody,
  stamp: {
    readonly id: string;
    readonly seq: number;
    readonly device?: string;
  },
): Promise<TapResult> {
  let base = state;
  let seq = stamp.seq;
  const missedSoFar: Event[] = [];
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const event: Event = {
      ...body,
      id: stamp.id,
      seq,
      at: Date.now(),
      ...(stamp.device === undefined ? {} : { device: stamp.device }),
    };
    if (round === 1) {
      // The UI offers only taps that apply; a refusal here is a bug, never a race.
      reduce(base, event);
    } else {
      try {
        reduce(base, event);
      } catch {
        return { kind: "changed", events: missedSoFar };
      }
    }
    const result = await log.append(event);
    switch (result.kind) {
      case "appended":
        return { kind: "appended", events: [...missedSoFar, event] };
      case "dropped":
        return { kind: "dropped" };
      case "stale":
        for (const missed of result.missed) {
          base = reduce(base, missed);
          missedSoFar.push(missed);
        }
        seq = (result.missed.at(-1)?.seq ?? seq) + 1;
        break;
      default:
        return assertNever(result);
    }
  }
  return { kind: "changed", events: missedSoFar };
}
