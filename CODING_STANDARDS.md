# Coding standards

How code is written in this repository. These rules are normative: every change follows them.
Adapted from `lharzenetter/checkbox-similator`.

Stack: TypeScript (strict) + Vite, a framework-free core, React UI, IndexedDB via `idb`,
`vite-plugin-pwa`, a Node sync server on built-ins only (`node:https`, `node:sqlite`), pnpm, Vitest,
Playwright, ESLint + Prettier.

## Naming

- Domain nouns come from `CONTEXT.md` and are used **verbatim**: `order`, `pager`, `buzz`,
  `handover`, `backToQueue`. Never invent synonyms; terms the glossary says to avoid (_Discard_)
  are banned in code too.
- Identifiers transliterate umlauts and ß (`schaeufele`, `fleischkaes`); strings shown to the
  window staff keep the real characters.
- Casing follows TypeScript convention: `camelCase` values and functions, `PascalCase` types and
  components, `UPPER_SNAKE_CASE` constants.

## Module layout and boundaries

| Folder     | Holds                                                    | May import | Browser APIs |
| ---------- | -------------------------------------------------------- | ---------- | ------------ |
| `core/`    | Pure fold/reducer, selectors, parameters, menu data      | nothing    | no           |
| `storage/` | Event log in IndexedDB, export/import, clearing the log  | `core`     | yes          |
| `ui/`      | React screens; `usePagerBoard()` owns state and dispatch | everything | yes          |
| `server/`  | Sync API, the SQLite log, the archive and the env config | nothing    | Node only    |

- Imports point one way only, as in the table. Only `ui/` imports React.
- `core/` has no DOM, no `Date.now()`, no timers and no randomness.
- Each layer exposes one public entry, `src/<layer>/index.ts`; other layers import only from it.
- `server/` sits at the top level, not in `src/`. It imports nothing from `src/`, and `src/` never
  imports `server/`; it imports only `node:` built-ins, always with the prefix, and its own files.
  Its entry points: `server/index.ts` (the `Request → Response` handler and the broadcast hook),
  `server/main.ts` (the only file that listens, and with the healthcheck the only one that reads
  `process.env`) and `server/healthcheck.ts` (a separate program the container runs).
- `contract/`, `acceptance/` and `e2e/` are test-only and exempt from the layer boundaries.
- Enforcement: ESLint `no-restricted-imports` per folder, and `tsconfig.pure.json` for `core`
  with `lib: ["ES2022"]` and no `DOM`. `server/` gets `globals.node`, no React hooks plugin, and
  `tsconfig.server.json` (`lib: ["ES2023"]`, no `DOM`, `module: "nodenext"`,
  `erasableSyntaxOnly`, imports ending in `.ts`), since Node runs it through type stripping.

## The core

- **The event log is the truth.** State is the persisted events folded through `reduce`, from
  `INITIAL_STATE`, rebuilt on launch with no snapshot.
- **Events** are a discriminated union on `type`, camelCase, past tense:
  `{ type: "platesBuzzed", orderId, productId, count }`. The ui/storage side stamps `id`, `seq`
  and `at`; the core never stamps.
- **State** is plain, immutable data: `readonly` types, no classes, no methods.
- **The reducer** throws only on an invariant violation from the event catalog. The UI disables
  actions that would violate one, so a throw means a bug.
- **Undo** appends `actionUndone` and never deletes; it is a strict stack over `state.live`.
- **Time** reaches the core only through event `at` stamps and the `now` argument of selectors.
- Every `switch` on a union ends in an `assertNever` default.
- Times are integer milliseconds named `…Ms` or `…At`. Parameters live in `core/parameters.ts`,
  the menu in `core/menu.ts`.

## The server

- **The server never runs `reduce`.** It parses an event no further than the protocol's shape
  checks (an object with a string `id` and an integer `seq`) and stores it as received.
- The clock is read only for archive names and pings.
- Never log the pairing code or a query string: a log line holds at most method, path and status.
- Every existing rule applies to `server/` unchanged.

## Testing

- `core/` is written test-first (red, green) for every behaviour change.
- A use case is stated once, as a scenario in `acceptance/scenarios/`, through
  `{ staff, see, time }`. Core tests cover reducer and selector detail only.
- Double loop: new behaviour starts with a failing scenario that cites its ticket (`// #42`), then
  the red/green loop in `src/core/`.
- A scenario names steps and observations with `CONTEXT.md` terms, imports no runner, and observes
  only what window staff can see. A rule the screen can't show belongs in a core test.
- Every step and observation is async, so a UI driver can run the same scenario.
- Core tests drive the public API only: a list of stamped events, `fold`, and selectors at a `now`.
  `storage/` is tested through `openDeviceStore` with `fake-indexeddb`.
- No real timers. Test names describe behaviour in glossary language.
- A test for a rule from a ticket cites its GitHub issue: `// #42`. Citations of the older local
  tickets (`// 05-exceptions`, `// server-sync 02`) stay as they are.
- `server/` is test-first for every protocol rule, driven through the handler with `Request`
  objects on a SQLite file in a fresh temp directory. A protocol scenario is written once, in
  `contract/`, and runs against both the fake sync server and the real handler. A rule from a
  ticket cites its issue: `// #42`.
- React components get thin tests only where they hold logic. Playwright covers the smoke flows
  on the built app.
- No coverage gate. Test files sit next to the code.

## Type checking, linting, formatting

- `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `verbatimModuleSyntax`.
- ESLint `strictTypeChecked` + `stylisticTypeChecked`, `eslint-plugin-react-hooks`, the boundary
  rules; no `any`, no `!`, no `as` casts outside tests, no `enum`, named exports only.
- Prettier defaults. Husky + lint-staged run both on staged files.
- CI runs `lint`, `typecheck`, `test`, `build` and the Playwright flows; any failure blocks.

## Files, functions, comments

- File names are `kebab-case.ts`; React components are `PascalCase.tsx`.
- `function` declarations at module level, not arrow-function constants.
- Comments say **why**, never what; a rule from the spec or a ticket cites its source.
- Domain terms are defined only in `CONTEXT.md`; code does not restate them.

## React UI

- One hook, `usePagerBoard()`, owns the state: each tap is reduced, appended in one strict
  IndexedDB transaction, and only then shown. No Redux, Zustand or broad Context.
- Components hold no domain logic: they read core selectors and dispatch events.
- Styling uses CSS Modules; UI copy is German, inline, with no i18n framework.
