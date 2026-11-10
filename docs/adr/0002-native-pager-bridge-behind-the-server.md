---
status: accepted
---

# A native pager bridge behind the server

When window staff buzz, the app sends the pager call itself
([#23](https://github.com/lharzenetter/order-processor/issues/23)). The transmitter is a Retekess
TD186 on USB serial, plugged into the venue machine: a small Windows PC that runs the server in
Docker Desktop. We decided that a separate .NET program, the pager bridge, drives the transmitter
natively on Windows, and that iPads reach it only through the server, which passes the call on.

## Native on Windows, not in Docker

The bridge runs as a Windows service built as a self-contained `win-x64` exe, outside Docker.

**Why:** Docker Desktop's VM can't see the COM port. Passing the device through with `usbipd-win`
needs re-attaching after every unplug or reboot, and pager calls would stop without anyone
noticing. A native service finds the transmitter by its heartbeat on whatever COM port it appears
on, and picks it up again after re-plugging.

**Cost:** a second program and a second language (C#) next to the TypeScript stack, with its own
build in CI and its own install step on the venue machine. It is Windows only for now.

## The server passes calls on; it still never runs `reduce`

An iPad sends the server an explicit "call pager N" request, separate from the event log, only
after the server appended the tap. The server forwards it to the bridge on the loopback and returns
OK, failed, or not connected.

**Why:** the page is served from `https://lharzenetter.github.io`, so anything an iPad calls needs
HTTPS with a trusted certificate, CORS and the pairing code. The server already has all of them. The
bridge then listens on plain HTTP, out of reach of the venue Wi-Fi, with no certificate to renew.

**Cost:** pager calls work only in sync mode, never on a standalone iPad. The server, which knew
nothing about pagers, now relays pager calls (it still knows nothing about orders).

## Considered options

- **The iPad calls the bridge directly.** Rejected: the bridge would need its own HTTPS endpoint,
  certificate renewal, CORS and pairing-code check.
- **The server calls the pager when it stores a `platesBuzzed` event.** Rejected: the server would
  act on event contents, against "the server never runs `reduce`", and a lost race would still call.
- **A PowerShell bridge.** Rejected as too fragile for a service that must run unattended all Fest.
- **Node with built-ins only.** Rejected: no reliable serial access (baud rate, RTS) without a
  native library.

## More Information

Spec: [#23](https://github.com/lharzenetter/order-processor/issues/23).
