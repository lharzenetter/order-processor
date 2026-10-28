import { scenario } from "../scenario";

scenario(
  "with nothing done yet, Rückgängig has nothing to undo",
  async ({ see }) => {
    await see.undo().offersNothing();
  },
);

scenario("Rückgängig names the newest action", async ({ staff, see }) => {
  await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
  await see.undo().offers("Neue Bestellung 1× Braten → Pager 7");
  await staff.buzz({ pager: 7, product: "braten" });
  await see.undo().offers("Braten gerufen → Pager 7");
});

// 05-exceptions: one undo stack, newest first, no time limit
scenario(
  "undo goes further back each time, newest first, with no time limit",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2 } });
    await staff.buzz({ pager: 7, product: "braten", count: "all" });
    await staff.undo();
    await see.buzzedList().isEmpty();
    await see.order({ pager: 7 }).hasOnly({ braten: { waiting: 2 } });
    await see.board("braten").has({ next: 7, queued: [] });
    await see.undo().offers("Neue Bestellung 2× Braten → Pager 7");
    await time.passes({ minutes: 24 * 60 });
    await staff.undo();
    await see.pager(7).isFree();
    await see.board("braten").nobodyWaits();
    await see.undo().offersNothing();
  },
);

// server-sync 03: the label names the iPad the action came from, on every iPad
scenario(
  "Rückgängig names the iPad the newest action came from",
  async ({ staff, see }) => {
    const links = staff.ipad("Links");
    await links.takeOrder({ pager: 12, plates: { braten: 1 } });
    await links.buzz({ pager: 12, product: "braten" });
    await see.undo().offers("Braten gerufen → Pager 12 (Links)");
  },
);

// #19
scenario(
  "an undo on one iPad takes back the newest action, whichever iPad made it",
  async ({ staff, see }) => {
    await staff.ipad("Links").takeOrder({ pager: 12, plates: { braten: 1 } });
    await staff.ipad("Links").buzz({ pager: 12, product: "braten" });
    await staff.ipad("Rechts").undo();
    await see.order({ pager: 12 }).hasOnly({ braten: { waiting: 1 } });
    await see.undo().offers("Neue Bestellung 1× Braten → Pager 12 (Links)");
  },
);

scenario(
  "undoing an order on a missing pager marks the pager missing again",
  async ({ staff, see }) => {
    await staff.markPagerMissing(23);
    await staff.takeOrder({ pager: 23, plates: { pommes: 1 } });
    await staff.undo();
    await see.pager(23).isMissing();
  },
);

// 10-event-catalog-and-core-state: strict stack, so the blocked undo is dropped
scenario(
  "a new order on a reused pager is undone before the handover that freed it",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { pommes: 1 } });
    await staff.handOver({ pager: 7, plates: { pommes: 1 } });
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await see.undo().offers("Neue Bestellung 1× Braten → Pager 7");
    await staff.undo();
    await see.undo().offers("Ausgabe Pager 7: 1× Pommes");
    await staff.undo();
    await see.order({ pager: 7 }).hasOnly({ pommes: { waiting: 1 } });
    await see.pager(7).isWithTheGuest();
  },
);

// #19
scenario(
  "undoing a hand on gives the plate back to the order that handed it on",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 1 } });
    await staff.takeOrder({ pager: 5, plates: { braten: 1 } });
    await staff.buzz({ pager: 12, product: "braten" });
    await staff.handOn({ from: 12, product: "braten" });
    await see.undo().offers("Braten weitergegeben: Pager 12 → Pager 5");
    await staff.undo();
    await see.order({ pager: 12 }).hasOnly({ braten: { buzzed: 1 } });
    await see.order({ pager: 5 }).hasOnly({ braten: { waiting: 1 } });
    await see.board("braten").has({ next: 5, queued: [] });
  },
);

// #19
scenario(
  "undoing a back to queue puts the plate back on the buzzed list",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await staff.buzz({ pager: 7, product: "braten" });
    await staff.sendBackToQueue({ pager: 7, product: "braten" });
    await see.undo().offers("Braten für Pager 7 zurück in Warteschlange");
    await staff.undo();
    await see.buzzedList().lists([{ pager: 7, product: "braten", plates: 1 }]);
    await see.board("braten").nobodyWaits();
  },
);

// #19
scenario(
  "undoing a re-buzz sets the buzzed list's clock back to the earlier buzz",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await staff.buzz({ pager: 7, product: "braten" });
    await time.passes({ minutes: 4 });
    await staff.rebuzz({ pager: 7, product: "braten" });
    await time.passes({ seconds: 30 });
    await see
      .buzzedList()
      .lists([{ pager: 7, product: "braten", since: { seconds: 30 } }]);
    await see.undo().offers("Pager 7 nochmal gerufen (Braten)");
    await staff.undo();
    await see
      .buzzedList()
      .lists([
        { pager: 7, product: "braten", since: { minutes: 4, seconds: 30 } },
      ]);
    await see.buzzedList().rebuzzDueFor({ pager: 7, product: "braten" });
  },
);

// #19
scenario(
  "undoing the handover that closed an order opens it again on its pager",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await staff.buzz({ pager: 7, product: "braten" });
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    await see.pager(7).isFree();
    await see.undo().offers("Ausgabe Pager 7: 1× Braten");
    await staff.undo();
    await see.pager(7).isWithTheGuest();
    await see.order({ pager: 7 }).hasOnly({ braten: { buzzed: 1 } });
    await see.buzzedList().lists([{ pager: 7, product: "braten", plates: 1 }]);
  },
);

// #19
scenario(
  "undoing a cancel puts the plate back on the order",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2 } });
    await staff.cancel({ pager: 7, product: "braten", count: 1 });
    await see.undo().offers("1× Braten storniert auf Pager 7");
    await staff.undo();
    await see.order({ pager: 7 }).hasOnly({ braten: { waiting: 2 } });
  },
);

// #19
scenario(
  "undoing a sold-out mark or its clearing switches the product back",
  async ({ staff, see }) => {
    await staff.markSoldOut("pommes");
    await see.undo().offers("Pommes ausverkauft");
    await staff.undo();
    await see.board("pommes").isNotSoldOut();
    await see.intake().noSoldOutWarningFor("pommes");
    await staff.markSoldOut("pommes");
    await staff.clearSoldOut("pommes");
    await see.undo().offers("Pommes wieder verfügbar");
    await staff.undo();
    await see.board("pommes").isSoldOut();
    await see.intake().warnsSoldOut("pommes");
  },
);

// #19
scenario(
  "undoing an abandoned order opens it again with its pager",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await staff.abandonOrder({ pager: 7, pagerBack: false });
    await see.undo().offers("Bestellung auf Pager 7 geschlossen, Pager fehlt");
    await staff.undo();
    await see.pager(7).isWithTheGuest();
    await see.order({ pager: 7 }).hasOnly({ braten: { waiting: 1 } });
    await see.board("braten").has({ next: 7, queued: [] });
  },
);

// #19
scenario(
  "undoing a restore marks the pager missing again, and undoing the mark frees it",
  async ({ staff, see }) => {
    await staff.markPagerMissing(23);
    await staff.restorePager(23);
    await see.undo().offers("Pager 23 wieder freigegeben");
    await staff.undo();
    await see.pager(23).isMissing();
    await see.undo().offers("Pager 23 als fehlend markiert");
    await staff.undo();
    await see.pager(23).isFree();
    await see.undo().offersNothing();
  },
);
