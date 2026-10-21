# Kirbe kitchen pager

Webapp for the kitchen window at the Feuerwehr Kirbe: guests hand in a prepaid meal voucher, get a pager, and are buzzed when their dishes are ready.

## Glossary

- **Meal voucher** — prepaid slip from the cashier listing the dishes a guest bought. Input to an order; the app does not issue or validate payment.
- **Window staff** — the only users. They take vouchers, enter orders, mark dishes ready, buzz pagers and hand over dishes.
- **Order** — the dishes from one voucher, as a count per product (e.g. 2× Braten, 1× Pommes), attached to one pager. Open until every dish is collected.
- **Product** — one dish (Speise) line of the menu, as a finished plate the kitchen pushes to the window (e.g. Pommes Frites, or Schweinebraten mit Kraut und Schupfnudeln as one plate). Unit of FIFO allocation. The window never puts plates together from parts.
- **Pager** — numbered device (1–30). Free, or attached to exactly one open order. Buzzed by hand on the transmitter.
- **Board** — the one staff view listing all open orders, showing per product which order is next (oldest still waiting for it).
- **Buzz** — when a plate comes out, window staff press the next order's pager number on the transmitter and mark that plate buzzed. Marking buzzed is what assigns the plate to the order; one plate per mark, or all of a row's remaining plates at once.
- **Handover** — a guest shows their pager; staff find the order by its pager number, see everything for that order, and mark what the guest takes as picked up. An order may have several handovers (partial pickup).
- **Pager return** — at the handover that completes the order, the pager comes back and becomes free.
- **Back to queue** (on screen: _Zurück in Warteschlange_) — a buzzed plate that can't be handed out (dropped, spoiled, left too long) is taken off the order, which waits for that product again with its FIFO place kept. Formerly called _Discard_; avoid that word.
- **Missing pager** — a pager number taken out of use because the device is lost, not returned or broken. Not offered at intake until restored.
- **Sold out** — a product the kitchen has run out of, toggled by staff. Intake warns before entering it; open orders still waiting for it are listed so staff can cancel those plates.
- **Update** — a newer build of the app. It takes over on the iPad only when staff tap _Aktualisieren_ in the Verwaltung, never on its own.

## On-screen language

The UI is German only. Domain term → on-screen word: Buzz → _Rufen / gerufen_; Re-buzz → _Nochmal rufen_; Hand on → _Weitergeben_; Back to queue → _Zurück in Warteschlange_; Cancel → _Stornieren_; Handover → _Ausgabe_; Board → _Übersicht_; Meal voucher / plate → _Bon / Teller_; Missing pager → _Pager fehlt_; Sold out → _Ausverkauft markieren_ (header button: _Ausverkauft…_); Undo → _Rückgängig_; Pager return → _Pager N zurücknehmen_; Status screen → _Verwaltung_; Update check → _Nach Updates suchen_; Install update → _Aktualisieren_; All pagers out → _Alle Pager vergeben_.
