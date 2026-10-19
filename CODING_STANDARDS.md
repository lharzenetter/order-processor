# Coding standards

How code is written in this repository. These rules are normative: every change follows them.
Adapted from `lharzenetter/checkbox-similator`.

Stack: TypeScript (strict) + Vite, a framework-free core, React UI, IndexedDB via `idb`,
`vite-plugin-pwa`, pnpm, Vitest, Playwright, ESLint + Prettier.

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

- Imports point one way only, as in the table. Only `ui/` imports React.
- `core/` has no DOM, no `Date.now()`, no timers and no randomness.
- Each layer exposes one public entry, `src/<layer>/index.ts`; other layers import only from it.
- Enforcement: ESLint `no-restricted-imports` per folder, and `tsconfig.pure.json` for `core`
  with `lib: ["ES2022"]` and no `DOM`.

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

## Testing

- `core/` is written test-first (red, green) for every behaviour change.
- Tests drive the public API only: a list of stamped events, `fold`, and selectors at a `now`.
  `storage/` is tested through `openDeviceStore` with `fake-indexeddb`.
- No real timers. Test names describe behaviour in glossary language.
- A test for a rule from a map ticket cites it: `// 05-exceptions`.
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
