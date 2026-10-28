import { scenario } from "../scenario";

scenario(
  "cancelling waiting plates keeps the order open while plates remain",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
    await staff.cancel({ pager: 7, product: "braten", count: 1 });
    await see.order({ pager: 7 }).hasOnly({
      braten: { waiting: 1 },
      pommes: { waiting: 1 },
    });
    await see.pager(7).isWithTheGuest();
    await see.board("braten").has({ next: 7 });
  },
);

// 05-exceptions: buzzed plates are only handed on or sent back, never cancelled
scenario("staff cannot cancel a buzzed plate", async ({ staff, see }) => {
  await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
  await staff.buzz({ pager: 7, product: "pommes" });
  await see.order({ pager: 7 }).cannotCancel("pommes");
});

scenario(
  "cancelling the last waiting plates closes the order and frees its pager",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
    await staff.cancel({ pager: 7, product: "braten", count: 2 });
    await staff.cancel({ pager: 7, product: "pommes", count: 1 });
    await see.pager(7).isFree();
    await see.intake().acceptsPager(7);
  },
);

// 05-exceptions: open orders still waiting for a sold-out product are listed
scenario(
  "a sold-out product lists the open orders still waiting for it",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2 } });
    await staff.takeOrder({ pager: 9, plates: { pommes: 1 } });
    await staff.buzz({ pager: 7, product: "braten" });
    await staff.markSoldOut("braten");
    await staff.markSoldOut("flammkuchen");
    await see.soldOut("braten").lists([{ pager: 7, plates: 1 }]);
    await see.soldOut("flammkuchen").nobodyWaits();
  },
);

// #17
scenario(
  "cancelling a sold-out product's waiting plates takes the order off its list",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
    await staff.takeOrder({ pager: 9, plates: { braten: 1 } });
    await staff.buzz({ pager: 7, product: "braten" });
    await staff.markSoldOut("braten");
    await see.soldOut("braten").lists([
      { pager: 7, plates: 1 },
      { pager: 9, plates: 1 },
    ]);
    await staff.cancel({ pager: 7, product: "braten", count: 1 });
    await see.soldOut("braten").lists([{ pager: 9, plates: 1 }]);
    await see.order({ pager: 7 }).hasOnly({
      braten: { buzzed: 1 },
      pommes: { waiting: 1 },
    });
  },
);

scenario(
  "a sold-out product is marked on the board",
  async ({ staff, see }) => {
    await staff.markSoldOut("pommes");
    await see.board("pommes").isSoldOut();
    await see.board("braten").isNotSoldOut();
  },
);

// #17
scenario(
  "intake warns before entering a sold-out product, but still takes it",
  async ({ staff, see }) => {
    await staff.markSoldOut("braten");
    await see.intake().warnsSoldOut("braten");
    await see.intake().noSoldOutWarningFor("pommes");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await see.soldOut("braten").lists([{ pager: 7, plates: 1 }]);
  },
);

scenario(
  "a product marked sold out can be cleared again",
  async ({ staff, see }) => {
    await staff.markSoldOut("braten");
    await staff.clearSoldOut("braten");
    await see.board("braten").isNotSoldOut();
    await see.intake().noSoldOutWarningFor("braten");
  },
);

// 12-operating-features-in-the-app: the paper fallback
scenario(
  "the Offene Bestellungen list shows each open order by pager with the plates still owed",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 2 } });
    await staff.takeOrder({ pager: 3, plates: { maultaschen: 1 } });
    await staff.takeOrder({ pager: 12, plates: { pommes: 1 } });
    await staff.buzz({ pager: 7, product: "braten" });
    await staff.handOver({ pager: 7, plates: { pommes: 1 } });
    await staff.handOver({ pager: 12, plates: { pommes: 1 } });
    await see.openOrdersList().lists([
      { pager: 3, lines: { maultaschen: { waiting: 1 } } },
      {
        pager: 7,
        lines: { braten: { buzzed: 1, waiting: 1 }, pommes: { waiting: 1 } },
      },
    ]);
  },
);
