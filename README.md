# Kirbe Essensausgabe

Offline web app for the kitchen window at the Kirbe of the Freiwillige Feuerwehr
Degerloch-Hoffeld: window staff enter a meal voucher, attach a pager, see per dish which order is
next (FIFO), buzz pagers and hand over the plates. It runs on one landscape iPad, installed to
the Home Screen from <https://lharzenetter.github.io/order-processor/>, and keeps everything on the
device as an append-only event log. In sync mode several iPads share one log through a small
server on the venue machine, a Windows PC, and a buzz calls the guest's pager by itself through
the pager bridge and the TD186 transmitter plugged into that PC; a standalone iPad leaves calling
to the transmitter's keypad. A kitchen station can run one of the iPads as a read-only
_Küchenanzeige_ showing how many plates of its dishes are still waiting. Setting up and running the
venue machine: [`deploy/RUNBOOK.md`](deploy/RUNBOOK.md).

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
- `pnpm sync-server` also starts a fake pager bridge on `http://127.0.0.1:9186`, so _Verwaltung →
  Sender_ shows _Sender verbunden_, a _Testruf_ or a buzz, re-buzz or hand on answers _Pager N
  gerufen_, _Alle Pager rufen_ answers _Alle Pager gerufen_, and _Alle Pager ausschalten_ answers
  _Pager ausgeschaltet_ once confirmed. With `{"connected":false}` the header shows _Sender getrennt_ within 5 s. Switching
  off _Pager automatisch rufen_ there stops the calls and the indicator on every iPad; the
  _Testruf_ still works. To try the other answers, tell it what to say:
  `curl -X PUT 127.0.0.1:9186/fake -d '{"result":"failed"}'` (or `"notConnected"`, or
  `{"connected":false}`); `-d '{}'` resets it.
- Every start of the server begins with an empty log.

### Pager bridge

`bridge/` is a separate .NET 10 program, the pager bridge: a Windows service on the venue machine
that calls pagers on the TD186 transmitter over USB, for the server. It needs the
[.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) and runs on Windows only; its tests
run anywhere. Run the commands in `bridge/`, so `dotnet` reads its `global.json`:

```sh
cd bridge
dotnet test       # protocol and discovery (xUnit, fake serial ports)
dotnet publish src/Bridge -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o publish
```

On the venue machine, `deploy/install-bridge.ps1 -Version <version>` (as administrator) installs or
updates the release's `order-processor-bridge-<version>.exe` as a service (runbook, section 1.8). It answers on
`http://127.0.0.1:9186`: `GET /status` gives `{ "connected": true }`, `POST /calls` with
`{ "pager": 21 }` calls pager 21, `POST /group-calls` with no body sends the group call, which
makes every pager outside the charging base vibrate, and `POST /power-offs` with no body sends the
power-off, which turns off every pager in the charging base. All three answer `{ "result": "ok" }`,
`"failed"` or `"notConnected"`.

The menu is `src/core/menu.ts`; edit it before a Fest, never during one.
Glossary: [`CONTEXT.md`](CONTEXT.md). Coding standards: [`CODING_STANDARDS.md`](CODING_STANDARDS.md).
