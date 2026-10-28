import { scenario } from "../scenario";

// 04-allocation-and-handover-rules: FIFO per product
scenario(
  "the board shows the oldest order still waiting for a product as next",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2 } });
    await staff.takeOrder({ pager: 5, plates: { pommes: 1, braten: 1 } });
    await see.board("braten").has({ next: 12, queued: [5] });
    await see.board("pommes").has({ next: 5, queued: [] });
    await see.board("maultaschen").nobodyWaits();
  },
);

scenario(
  "an order stays next until all its plates of that product are buzzed",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2 } });
    await staff.takeOrder({ pager: 5, plates: { braten: 1 } });
    await staff.buzz({ pager: 12, product: "braten" });
    await see.board("braten").has({ next: 12, queued: [5] });
    await staff.buzz({ pager: 12, product: "braten" });
    await see.board("braten").has({ next: 5, queued: [] });
  },
);

// 04-allocation-and-handover-rules: a no-show's plate moves on, the giver keeps its FIFO place
scenario(
  "a plate handed on goes to the next order waiting for it, and the giver waits again in its place",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 1 } });
    await staff.takeOrder({ pager: 5, plates: { braten: 1 } });
    await staff.takeOrder({ pager: 9, plates: { braten: 1 } });
    await staff.buzz({ pager: 12, product: "braten" });
    await time.passes({ minutes: 3, seconds: 20 });
    await staff.handOn({ from: 12, product: "braten" });
    await see.order({ pager: 12 }).hasOnly({ braten: { waiting: 1 } });
    await see.order({ pager: 5 }).hasOnly({ braten: { buzzed: 1 } });
    await see.board("braten").has({ next: 12, queued: [9] });
  },
);

// 04-allocation-and-handover-rules: the hand-on counts as the receiver's buzz
scenario(
  "a plate handed on starts the receiver's clock in the buzzed list",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 1 } });
    await staff.takeOrder({ pager: 5, plates: { braten: 1 } });
    await staff.buzz({ pager: 12, product: "braten" });
    await time.passes({ minutes: 3, seconds: 20 });
    await staff.handOn({ from: 12, product: "braten" });
    await time.passes({ seconds: 10 });
    await see
      .buzzedList()
      .lists([
        { pager: 5, product: "braten", plates: 1, since: { seconds: 10 } },
      ]);
  },
);

// #16
scenario(
  "staff cannot hand on a plate while no other order waits for it",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2 } });
    await staff.takeOrder({ pager: 5, plates: { pommes: 1 } });
    await staff.buzz({ pager: 12, product: "braten" });
    // Pager 12 still waits for its second Braten, but cannot receive its own plate.
    await see.order({ pager: 12 }).cannotHandOn("braten");
  },
);

// 05-exceptions: a buzzed plate that can't be handed out waits again with its FIFO place kept
scenario(
  "a plate sent back to queue waits again in its order's place",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 1 } });
    await staff.takeOrder({ pager: 5, plates: { braten: 1 } });
    await staff.buzz({ pager: 12, product: "braten" });
    await see.board("braten").has({ next: 5 });
    await staff.sendBackToQueue({ pager: 12, product: "braten" });
    await see.board("braten").has({ next: 12, queued: [5] });
    await see.order({ pager: 12 }).hasOnly({ braten: { waiting: 1 } });
    await see.buzzedList().isEmpty();
  },
);

// #16
scenario(
  "back to queue clears the line's clock only when its last buzzed plate goes back",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2 } });
    await staff.buzz({ pager: 12, product: "braten", count: "all" });
    await time.passes({ seconds: 30 });
    await staff.sendBackToQueue({ pager: 12, product: "braten" });
    await see
      .buzzedList()
      .lists([
        { pager: 12, product: "braten", plates: 1, since: { seconds: 30 } },
      ]);
    await staff.sendBackToQueue({ pager: 12, product: "braten" });
    await staff.buzz({ pager: 12, product: "braten" });
    await time.passes({ seconds: 1 });
    await see
      .buzzedList()
      .lists([
        { pager: 12, product: "braten", plates: 1, since: { seconds: 1 } },
      ]);
  },
);

// #16
scenario(
  "the buzzed list shows the time since each buzz",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2, pommes: 1 } });
    await staff.buzz({ pager: 12, product: "braten" });
    await time.passes({ seconds: 40 });
    await see
      .buzzedList()
      .lists([
        { pager: 12, product: "braten", plates: 1, since: { seconds: 40 } },
      ]);
    await see.buzzedList().noRebuzzDueFor({ pager: 12, product: "braten" });
  },
);

// #16
scenario(
  "the buzzed list lists the oldest buzz first",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2, pommes: 1 } });
    await staff.takeOrder({ pager: 3, plates: { schaeufele: 1 } });
    await staff.buzz({ pager: 3, product: "schaeufele" });
    await time.passes({ seconds: 1 });
    await staff.buzz({ pager: 12, product: "pommes" });
    await time.passes({ seconds: 1 });
    await staff.buzz({ pager: 12, product: "braten", count: "all" });
    await see.buzzedList().lists([
      { pager: 3, product: "schaeufele", plates: 1 },
      { pager: 12, product: "pommes", plates: 1 },
      { pager: 12, product: "braten", plates: 2 },
    ]);
  },
);

// 04-allocation-and-handover-rules: re-buzz highlight after 3 min
scenario(
  "a re-buzz is due once a line has waited 3 minutes since its buzz",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2 } });
    await staff.buzz({ pager: 12, product: "braten" });
    await time.passes({ minutes: 2, seconds: 59 });
    await see.buzzedList().noRebuzzDueFor({ pager: 12, product: "braten" });
    await time.passes({ seconds: 1 });
    await see.buzzedList().rebuzzDueFor({ pager: 12, product: "braten" });
  },
);

// #16
scenario(
  "a re-buzz restarts the line's clock",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2 } });
    await staff.buzz({ pager: 12, product: "braten" });
    await time.passes({ minutes: 3 });
    await staff.rebuzz({ pager: 12, product: "braten" });
    await time.passes({ seconds: 5 });
    await see.buzzedList().includes({
      pager: 12,
      product: "braten",
      since: { seconds: 5 },
    });
    await see.buzzedList().noRebuzzDueFor({ pager: 12, product: "braten" });
  },
);

// #16
scenario(
  "buzzing another plate onto a buzzed line keeps its clock",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 12, plates: { braten: 2 } });
    await staff.buzz({ pager: 12, product: "braten" });
    await time.passes({ minutes: 3 });
    await staff.buzz({ pager: 12, product: "braten" });
    await see.buzzedList().includes({
      pager: 12,
      product: "braten",
      plates: 2,
      since: { minutes: 3 },
    });
    await see.buzzedList().rebuzzDueFor({ pager: 12, product: "braten" });
  },
);
