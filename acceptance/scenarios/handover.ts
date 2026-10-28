import { scenario } from "../scenario";

scenario(
  "an order taken on a free pager attaches it to the guest",
  async ({ staff, see }) => {
    await see.intake().acceptsPager(7);
    await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
    await see.pager(7).isWithTheGuest();
    await see.order({ pager: 7 }).hasOnly({
      braten: { waiting: 2 },
      pommes: { waiting: 1 },
    });
  },
);

scenario(
  "intake refuses a pager still with a guest",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { pommes: 1 } });
    await see.intake().refusesPager(7);
  },
);

scenario("a buzzed plate shows in the buzzed list", async ({ staff, see }) => {
  await staff.takeOrder({ pager: 12, plates: { braten: 2, pommes: 1 } });
  await staff.buzz({ pager: 12, product: "braten" });
  await see.buzzedList().lists([{ pager: 12, product: "braten", plates: 1 }]);
  await see.order({ pager: 12 }).has({ braten: { buzzed: 1, waiting: 1 } });
});

scenario(
  "staff cannot buzz more plates than are waiting",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2 } });
    await staff.buzz({ pager: 12, product: "braten", count: "all" });
    await see.order({ pager: 12 }).cannotBuzz("braten");
  },
);

// 04-allocation-and-handover-rules: partial pickup keeps the pager with the guest
scenario(
  "a partial pickup keeps the pager with the guest",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
    await staff.buzz({ pager: 7, product: "braten" });
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    await see.buzzedList().isEmpty();
    await see.order({ pager: 7 }).hasOnly({
      braten: { waiting: 1 },
      pommes: { waiting: 1 },
    });
    await see.pager(7).isWithTheGuest();
  },
);

scenario("unbuzzed plates can be handed over too", async ({ staff, see }) => {
  await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
  await staff.buzz({ pager: 7, product: "braten" });
  await staff.handOver({ pager: 7, plates: { braten: 2 } });
  await see.order({ pager: 7 }).hasOnly({ pommes: { waiting: 1 } });
});

// 04-allocation-and-handover-rules: the pager is freed on the last handover
scenario(
  "the handover that empties the order frees its pager",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
    await staff.buzz({ pager: 7, product: "braten", count: "all" });
    await staff.handOver({ pager: 7, plates: { braten: 2, pommes: 1 } });
    await see.pager(7).isFree();
    await see.intake().acceptsPager(7);
  },
);

scenario(
  "staff cannot hand over more plates than are open",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
    await see.order({ pager: 7 }).cannotHandOver({ pommes: 2 });
  },
);
