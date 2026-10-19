/**
 * Closes every `switch` on a union: the call only typechecks once all members are
 * handled, and it throws if an unhandled value still arrives at runtime.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
