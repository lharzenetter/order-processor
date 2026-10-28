---
status: accepted
---

# Acceptance scenarios with swappable drivers

Our use cases are spread across `src/core/*.test.ts`, written against `fold` and raw state, and
none of them can run against the real UI. The
[acceptance-test DSL spec](https://github.com/lharzenetter/order-processor/issues/14) states each
use case once in `acceptance/scenarios/`, through `{ staff, see, time }`, and makes three choices
that a future reader would not expect.

## One scenario, swappable drivers

A scenario imports no runner. The core driver runs it on `fold` and the selectors today, and a
Playwright UI driver can run the same scenario later
([#5](https://github.com/lharzenetter/order-processor/issues/5)). `contract/` already does this
for the sync protocol.

**Why:** a use case written once can't drift between a core version and a UI version, and the UI
driver reuses every scenario instead of restating it.

**Cost:** each step and observation in `window.ts` needs one implementation per driver. A scenario
may use only what every driver can do, so it can't reach for something the core driver could easily
give it.

## Async steps over a synchronous core

Every step and observation returns a `Promise`, even though `reduce` and the selectors are
synchronous.

**Why:** Playwright is async. A synchronous DSL would mean rewriting every scenario when the UI
driver arrives.

**Cost:** each line of a scenario carries an `await`, and the core driver wraps synchronous calls
in promises it doesn't need. A missing `await` can let a failure go unnoticed;
`no-floating-promises` catches it.

## Observations only through the screen, with no escape hatch to raw state

`see` checks only what window staff can see
([#7](https://github.com/lharzenetter/order-processor/issues/7)). In the core driver each
observation maps to a selector, and in the UI driver it will map to a locator. Refusals are
observations too (`cannotBuzz`, `cannotHandOver`, `refusesPager`), meant to be answered by the
same selectors the UI uses to disable buttons. No call returns raw state, not even "just for this
test".

**Why:** the UI driver can only answer what the screen shows. A single escape hatch would split the
suite into scenarios that both drivers can run and scenarios that only the core driver can run,
and nobody would notice.

**Cost:** a rule the screen can't show stays a core unit test, so `acceptance/` is not the whole
story of what the core enforces. The observation catalog grows with each area, and every new check
needs a selector the UI already uses, or a new one.

## Considered options

- **Gherkin (Cucumber).** Rejected: it adds new tooling and a step-matching layer, where plain
  TypeScript calls need neither.
- **A synchronous DSL now, made async later.** Rejected: switching would touch every scenario.
