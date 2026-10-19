# Kirbe Essensausgabe

Offline web app for the kitchen window at the Kirbe of the Freiwillige Feuerwehr
Degerloch-Hoffeld: window staff enter a meal voucher, attach a pager, see per dish which order is
next (FIFO), buzz pagers by hand and hand over the plates. It runs on one landscape iPad, installed
to the Home Screen from <https://lharzenetter.github.io/order-processor/>, and keeps everything on
the device as an append-only event log.

## Development

```sh
nvm use
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # core and storage (Vitest)
pnpm test:e2e     # smoke flows on the built app (Playwright)
pnpm lint && pnpm typecheck
```

The menu is `src/core/menu.ts`; edit it before a Fest, never during one.
Glossary: [`CONTEXT.md`](CONTEXT.md). Coding standards: [`CODING_STANDARDS.md`](CODING_STANDARDS.md).
