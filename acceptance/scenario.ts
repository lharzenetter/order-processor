import type { Window } from "./window";

export interface Scenario {
  readonly name: string;
  readonly run: (window: Window) => Promise<void>;
}

const registered: Scenario[] = [];

/** Registers a use case without naming a runner, so each driver's test file binds them all (#5). */
export function scenario(
  name: string,
  run: (window: Window) => Promise<void>,
): void {
  registered.push({ name, run });
}

export function scenarios(): readonly Scenario[] {
  return registered;
}
