# Kirbe Essensausgabe

Offline web app for the kitchen window at the Kirbe of the Freiwillige Feuerwehr
Degerloch-Hoffeld: window staff enter a meal voucher, attach a pager, see per dish which order is
next (FIFO), buzz pagers by hand and hand over the plates. It runs on one landscape iPad, installed
to the Home Screen from <https://lharzenetter.github.io/order-processor/>, and keeps everything on
the device as an append-only event log. In sync mode several iPads share one log through a small
server at the venue ([`deploy/RUNBOOK.md`](deploy/RUNBOOK.md)); a kitchen station can run one of
them as a read-only _Küchenanzeige_ showing how many plates of its dishes are still waiting.

## Development

```sh
nvm use
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # core and storage (Vitest)
pnpm test:e2e     # smoke flows on the built app (Playwright)
pnpm lint && pnpm typecheck
```

### Sync mode locally

The e2e flows start their own sync server. To try sync mode or the Küchenanzeige by hand, run the
same server and the built app in two terminals:

```sh
pnpm sync-server                        # https://localhost:8443, Kopplungscode KIRBE234
pnpm build && pnpm preview --port 4173  # the only origin the local server accepts
```

- Install [mkcert](https://github.com/FiloSottile/mkcert) once (`brew install mkcert && mkcert -install`,
  then restart the browser). The server's certificate is then trusted with no warning. Without
  mkcert it falls back to a self-signed one that Chrome only accepts if you type `thisisunsafe` on
  its warning page, and Safari not at all.
- Open `http://localhost:4173/order-processor/` in a normal and a private window: they are two
  iPads, since each profile keeps its own log. In each, _Verwaltung → Server_: Adresse
  `localhost:8443`, Kopplungscode `KIRBE234`, a Gerätename, _Verbinden_.
- In one of them, _Verwaltung → Küchenanzeige…_ turns it into the Küchenanzeige; hold its corner
  button to change the Auswahl or end it.
- Every start of the server begins with an empty log.

The menu is `src/core/menu.ts`; edit it before a Fest, never during one.
Glossary: [`CONTEXT.md`](CONTEXT.md). Coding standards: [`CODING_STANDARDS.md`](CODING_STANDARDS.md).
