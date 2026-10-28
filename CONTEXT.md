# Kirbe kitchen pager

Webapp for the kitchen window at the Feuerwehr Kirbe: guests hand in a prepaid meal voucher, get a pager, and are buzzed when their dishes are ready.

## Glossary

- **Meal voucher** — prepaid slip from the cashier listing the dishes a guest bought. Input to an order; the app does not issue or validate payment.
- **Window staff** — the only users. They take vouchers, enter orders, mark dishes ready, buzz pagers and hand over dishes.
- **Order** — the dishes from one voucher, as a count per product (e.g. 2× Braten, 1× Pommes), attached to one pager. Open until every dish is collected.
- **Product** — one dish (Speise) line of the menu, as a finished plate the kitchen pushes to the window (e.g. Pommes Frites, or Schweinebraten mit Kraut und Schupfnudeln as one plate). Unit of FIFO allocation. The window never puts plates together from parts.
- **Pager** — numbered device (1–30). Free, or attached to exactly one open order. Buzzed by hand on the transmitter.
- **Board** — the one staff view listing all open orders, showing per product which order is next (oldest still waiting for it).
- **Waiting plates** — the plates of a product that open orders still wait for: not buzzed, picked up or cancelled. A plate sent back to queue waits again.
- **Kitchen display** (on screen: _Küchenanzeige_) — an iPad in sync mode, set up for a kitchen station, that shows only the number of waiting plates for each product in its product selection. It never records a staff action. Avoid _read-only mode_.
- **Product selection** (on screen: _Auswahl_) — the products a kitchen display shows, chosen on that iPad. Not part of the event log.
- **Buzz** — when a plate comes out, window staff press the next order's pager number on the transmitter and mark that plate buzzed. Marking buzzed is what assigns the plate to the order; one plate per mark, or all of a row's remaining plates at once.
- **Buzzed list** (on screen: _Gerufen_) — the board column listing every order line with plates buzzed and not yet picked up, the oldest buzz first. Staff open an order from it for the handover, and re-buzz from it.
- **Re-buzz** (on screen: _Nochmal rufen_) — buzzing an order's pager again for a plate already buzzed, when its guest hasn't come after 3 minutes. It only restarts the reminder; the plate stays with the order, and waiting time and pickup time ignore it.
- **Hand on** (on screen: _Weitergeben_) — a buzzed plate whose guest hasn't come goes to the next order waiting for that product instead, and counts as buzzed for it. The giving order waits again with its FIFO place kept. Only possible while another order waits for the product.
- **Handover** — a guest shows their pager; staff find the order by its pager number, see everything for that order, and mark what the guest takes as picked up. An order may have several handovers (partial pickup).
- **Waiting time** (on screen: _Wartezeit_) — how long a guest waits for a plate to come out: from the order being taken until the plate's last buzz (not counting re-buzzes), or until its handover if it was never buzzed. A plate sent back to queue or handed on waits again. Only picked-up and abandoned plates have one.
- **Pickup time** (on screen: _Abholzeit_) — how long a buzzed plate waits for its guest: from its last buzz until it is picked up. A re-buzz does not restart it. Only plates picked up after a buzz have one.
- **Evaluation** (on screen: _Auswertung_) — the per-product totals of the Kirbe: plates made, plates handed over, average waiting time and pickup time, when a product sold out.
- **Kirbe day** — Samstag, Sonntag or Montag; the Kirbe always runs these three days.
- **Crew** (on screen: _Gruppe_) — a named team of volunteers (A, B, C), the same people on every Kirbe day, with one shift per day.
- **Shift** (on screen: _Schicht_) — one crew's planned time on one Kirbe day (e.g. Samstag · Gruppe A 10–15), as in the Festbetrieb plan. Shifts may overlap, but the evaluation counts each moment for one shift only: a shift counts from the end of the shift before it. The last shift of a day has an open end, and the Kirbe's first shift also counts everything before it. Avoid _Einsatz_.
- **Pager return** — when an order closes (its last handover, its last plates cancelled, or abandoned with the pager back), the pager comes back and becomes free.
- **Cancel** (on screen: _Stornieren_) — take waiting plates of a product off an order, e.g. when it is sold out. Only waiting plates can be cancelled; a buzzed plate is handed on or sent back to queue instead. An order with nothing left closes.
- **Back to queue** (on screen: _Zurück in Warteschlange_) — a buzzed plate that can't be handed out (dropped, spoiled, left too long) is taken off the order, which waits for that product again with its FIFO place kept. Formerly called _Discard_; avoid that word.
- **Abandoned order** (on screen: _Verwaiste Bestellung schließen_) — an open order whose guest is gone, closed by staff. Its buzzed plates count as never handed over, its waiting plates as cancelled; the pager comes back free or is marked a missing pager.
- **Undo** (on screen: _Rückgängig_) — take back the newest staff action still in force, whichever iPad made it. Repeating it goes further back, with no time limit. An undo cannot be undone, and the event log keeps both the action and its undo.
- **Missing pager** — a pager number taken out of use because the device is lost, not returned or broken. Not offered at intake until restored.
- **Sold out** — a product the kitchen has run out of, toggled by staff. Intake warns before entering it; open orders still waiting for it are listed so staff can cancel those plates.
- **Standalone** (on screen: _Eigenständig_) — an iPad that keeps its own event log with no server. The default, and the fallback.
- **Sync mode** — two or more iPads at the window share one event log through the server. A tap counts once the server has it.
- **Server** — the small program on the Pi at the venue that holds the shared event log in order. It knows nothing about orders or pagers.
- **Mirror** — an iPad's full copy of the server's event log in sync mode. It keeps the board visible while disconnected, and standalone carries on from it. Never on screen.
- **Event log** (on screen: _Protokoll_) — every recorded staff action, in order. The truth the board is computed from.
- **Pairing code** (on screen: _Kopplungscode_) — the shared code an iPad sends with every request to the server.
- **Device name** (on screen: _Gerätename_) — an iPad's short name, shown in the undo label and in the replacement toasts.
- **Connect / Disconnect** (on screen: _Verbinden_ / _Trennen_) — switching an iPad into sync mode and back to standalone. Disconnecting keeps the mirror.
- **Replace the log** — a first push, _Neues Fest starten_, _Import_, or _Server überschreiben_. The server archives the old log and every iPad follows.
- **Archive** — the server's copy of every replaced log, as an export file.
- Avoid _merge_ (logs are never merged), and _sync_ as an on-screen verb.
- **Update** — a newer build of the app. It takes over on the iPad only when staff tap _Aktualisieren_ in the Verwaltung, never on its own.

## On-screen language

The UI is German only. Domain term → on-screen word: Buzz → _Rufen / gerufen_; Buzzed list → _Gerufen_; Re-buzz → _Nochmal rufen_; Hand on → _Weitergeben_; Back to queue → _Zurück in Warteschlange_; Cancel → _Stornieren_; Abandoned order → _Verwaiste Bestellung schließen_; Handover → _Ausgabe_; Board → _Übersicht_; Meal voucher / plate → _Bon / Teller_; Missing pager → _Pager fehlt_; Sold out → _Ausverkauft markieren_ (header button: _Ausverkauft…_); Undo → _Rückgängig_; Pager return → _Pager N zurücknehmen_; Status screen → _Verwaltung_; Update check → _Nach Updates suchen_; Install update → _Aktualisieren_; All pagers out → _Alle Pager vergeben_; Standalone → _Eigenständig_; Connect → _Verbinden_; Disconnect → _Trennen_; Pairing code → _Kopplungscode_; Device name → _Gerätename_; Event log → _Protokoll_; Kitchen display → _Küchenanzeige_; Product selection → _Auswahl_; Waiting time → _Wartezeit_; Evaluation → _Auswertung_; Shift → _Schicht_; Crew → _Gruppe_.
