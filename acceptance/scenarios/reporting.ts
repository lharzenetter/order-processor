import { scenario } from "../scenario";

// #3: the waiting time runs from intake to the plate's buzz
scenario(
  "the Auswertung averages the waiting time of every plate, from intake to its buzz",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 2 } });
    await time.passes({ minutes: 5 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 3 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 10 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 2 } });
    // (5 + 8) / 2 minutes
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ waitingTime: { minutes: 6, seconds: 30 } });
  },
);

// #3
scenario(
  "the waiting time of a plate never buzzed runs until its handover",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 2 } });
    await time.passes({ minutes: 5 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 8 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 1 } });
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ waitingTime: { minutes: 9 } });
  },
);

// #3
scenario(
  "a re-buzz does not end the waiting time",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 10 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 5 });
    await staff.rebuzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 2 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 1 } });
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ waitingTime: { minutes: 10 } });
  },
);

// #3
scenario(
  "each plate of one handover counts as its own waiting time",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 2 } });
    await time.passes({ minutes: 2 });
    await staff.takeOrder({ pager: 9, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 4 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 2 } });
    await staff.handOver({ pager: 9, plates: { flammkuchen: 1 } });
    // (6 + 6 + 4) / 3 minutes
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ waitingTime: { minutes: 5, seconds: 20 } });
  },
);

// #3
scenario(
  "an abandoned plate waits until its buzz, and a cancelled plate has no waiting time",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 3 } });
    await staff.takeOrder({ pager: 9, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 3 });
    await staff.cancel({ pager: 7, product: "flammkuchen", count: 1 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 2 } });
    await time.passes({ minutes: 30 });
    await staff.buzz({ pager: 9, product: "flammkuchen" });
    await staff.abandonOrder({ pager: 9, pagerBack: true });
    // (3 + 3 + 33) / 3 minutes
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ waitingTime: { minutes: 13 } });
  },
);

// #3
scenario(
  "a plate sent back to queue waits again until its replacement is buzzed",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 5 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 3 });
    await staff.sendBackToQueue({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 6 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 2 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 1 } });
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ waitingTime: { minutes: 14 }, pickupTime: { minutes: 2 } });
  },
);

// #3
scenario(
  "a plate handed on ends the receiver's waiting time and starts its pickup time",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 1 } });
    await staff.takeOrder({ pager: 9, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 4 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 6 });
    await staff.handOn({ from: 7, product: "flammkuchen" });
    await time.passes({ minutes: 1 });
    await staff.handOver({ pager: 9, plates: { flammkuchen: 1 } });
    await staff.abandonOrder({ pager: 7, pagerBack: true });
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ waitingTime: { minutes: 10 }, pickupTime: { minutes: 1 } });
  },
);

// #3
scenario(
  "an undone handover leaves the Auswertung without a waiting time",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 4 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 1 } });
    await staff.undo();
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ handedOver: 0, waitingTime: "none" });
  },
);

// #3: the order popup shows how long a line still waits
scenario(
  "the order popup shows the waiting time from intake to now, through a partial handover",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 2 } });
    await time.passes({ minutes: 5 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 7 });
    await see
      .order({ pager: 7 })
      .showsWaitingTime("flammkuchen", { minutes: 12 });
  },
);

scenario(
  "the Auswertung averages the pickup time of every plate, from its buzz to its handover",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 2 } });
    await time.passes({ minutes: 5 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 3 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 1 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 2 } });
    // (4 + 1) / 2 minutes
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ pickupTime: { minutes: 2, seconds: 30 } });
  },
);

// #16: waiting time and pickup time ignore a re-buzz
scenario(
  "a re-buzz does not restart the pickup time",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 10 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 5 });
    await staff.rebuzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 2 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 1 } });
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ pickupTime: { minutes: 7 } });
  },
);

scenario(
  "a plate handed over without a buzz has no pickup time",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 2 } });
    await time.passes({ minutes: 5 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 3 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 2 } });
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ pickupTime: { minutes: 3 } });
  },
);

scenario(
  "an abandoned plate has no pickup time",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 1 } });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 30 });
    await staff.abandonOrder({ pager: 7, pagerBack: true });
    await see
      .evaluation()
      .row("flammkuchen")
      .has({ made: 1, handedOver: 0, pickupTime: "none" });
  },
);

scenario(
  "the order popup shows the pickup time from the line's first buzz to now, through a re-buzz",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 2 } });
    await time.passes({ minutes: 5 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 2 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 3 });
    await staff.rebuzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 1 });
    await see
      .order({ pager: 7 })
      .showsPickupTime("flammkuchen", { minutes: 6 });
  },
);

// 11-after-event-numbers
scenario(
  "the Auswertung counts per product the plates made and handed over, and when it first sold out",
  async ({ staff, see, time }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 3 } });
    await staff.takeOrder({ pager: 9, plates: { braten: 2 } });
    await staff.buzz({ pager: 7, product: "braten", count: "all" });
    await staff.sendBackToQueue({ pager: 7, product: "braten" });
    await staff.handOver({ pager: 7, plates: { braten: 2 } });
    await staff.cancel({ pager: 7, product: "braten", count: 1 });
    await staff.buzz({ pager: 9, product: "braten" });
    await staff.abandonOrder({ pager: 9, pagerBack: true });
    await time.isNow("Samstag 10:01");
    await staff.markSoldOut("braten");
    await staff.clearSoldOut("braten");
    await time.isNow("Samstag 10:02");
    await staff.markSoldOut("braten");
    await staff.markSoldOut("pommes");
    await staff.clearSoldOut("pommes");
    // made = picked up 2 + abandoned 1 + back to queue 1
    await see
      .evaluation()
      .row("braten")
      .has({
        made: 4,
        handedOver: 2,
        waitingTime: { minutes: 0 },
        pickupTime: { minutes: 0 },
        soldOut: { at: "10:01" },
      });
    await see
      .evaluation()
      .row("pommes")
      .has({ made: 0, soldOut: { at: "10:02", availableAgain: true } });
    await see.evaluation().row("maultaschen").has({
      made: 0,
      handedOver: 0,
      waitingTime: "none",
      pickupTime: "none",
      soldOut: "never",
    });
  },
);

// #19: an undone mark is forgotten
scenario(
  "an undone sold-out mark leaves no sold-out time in the Auswertung",
  async ({ staff, see }) => {
    await staff.markSoldOut("braten");
    await staff.undo();
    await see.evaluation().row("braten").has({ soldOut: "never" });
  },
);

scenario(
  "a shift counts a plate handed over in it, with its whole waiting time",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 14:55");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Samstag 15:10");
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    await see
      .evaluation({ day: "Samstag", crew: "A" })
      .row("braten")
      .has({ made: 0, handedOver: 0, waitingTime: "none" });
    await see
      .evaluation({ day: "Samstag", crew: "B" })
      .row("braten")
      .has({ made: 1, handedOver: 1, waitingTime: { minutes: 15 } });
  },
);

scenario(
  "a handover while two shifts overlap counts for the earlier shift only",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 14:20");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Samstag 14:30");
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    await see
      .evaluation({ day: "Samstag", crew: "A" })
      .row("braten")
      .has({ handedOver: 1 });
    await see
      .evaluation({ day: "Samstag", crew: "B" })
      .row("braten")
      .has({ handedOver: 0 });
  },
);

scenario(
  "a handover at the very end of a shift counts for the next one",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 14:50");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Samstag 15:00");
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    await see
      .evaluation({ day: "Samstag", crew: "B" })
      .row("braten")
      .has({ handedOver: 1 });
  },
);

scenario(
  "the night after the last shift of a day counts for that shift, across the end of summer time",
  async ({ staff, see, time }) => {
    await time.isNow("Sonntag 01:30");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Sonntag 03:30");
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    // 01:30 summer time to 03:30 winter time: the clocks went back an hour in between.
    await see
      .evaluation({ day: "Samstag", crew: "C" })
      .row("braten")
      .has({ handedOver: 1, waitingTime: { minutes: 180 } });
  },
);

scenario(
  "a plate sent back to queue counts as made in the shift it went back",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 14:50");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await staff.buzz({ pager: 7, product: "braten" });
    await time.isNow("Samstag 15:05");
    await staff.sendBackToQueue({ pager: 7, product: "braten" });
    await see
      .evaluation({ day: "Samstag", crew: "A" })
      .row("braten")
      .has({ made: 0 });
    await see
      .evaluation({ day: "Samstag", crew: "B" })
      .row("braten")
      .has({ made: 1 });
  },
);

// #19
scenario(
  "a shift does not count an undone handover",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 14:50");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Samstag 15:10");
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    await staff.undo();
    await see
      .evaluation({ day: "Samstag", crew: "B" })
      .row("braten")
      .has({ handedOver: 0 });
  },
);

scenario(
  "a shift shows when a product sold out in it, and a later shift that it started without it",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 19:40");
    await staff.markSoldOut("braten");
    await see
      .evaluation({ day: "Samstag", crew: "A" })
      .row("braten")
      .has({ soldOut: "never" });
    await see
      .evaluation({ day: "Samstag", crew: "B" })
      .row("braten")
      .has({ soldOut: { at: "19:40" } });
    await see
      .evaluation({ day: "Samstag", crew: "C" })
      .row("braten")
      .has({ soldOut: { since: { day: "Samstag", crew: "B" } } });
  },
);

scenario(
  "a shift shows a product as available again where it was cleared",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 19:40");
    await staff.markSoldOut("braten");
    await time.isNow("Samstag 21:00");
    await staff.clearSoldOut("braten");
    await see
      .evaluation({ day: "Samstag", crew: "B" })
      .row("braten")
      .has({ soldOut: { at: "19:40" } });
    await see
      .evaluation({ day: "Samstag", crew: "C" })
      .row("braten")
      .has({
        soldOut: {
          since: { day: "Samstag", crew: "B" },
          availableAgain: true,
        },
      });
    await see
      .evaluation({ day: "Sonntag", crew: "C" })
      .row("braten")
      .has({ soldOut: "never" });
  },
);

scenario(
  "the Vergleich counts each plate in the shift of its handover, with its waiting and pickup time",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 14:50");
    await staff.takeOrder({ pager: 7, plates: { flammkuchen: 1 } });
    await time.passes({ minutes: 5 });
    await staff.buzz({ pager: 7, product: "flammkuchen" });
    await time.passes({ minutes: 15 });
    await staff.handOver({ pager: 7, plates: { flammkuchen: 1 } });
    await see
      .comparison({ day: "Samstag", crew: "B" })
      .row("flammkuchen")
      .has({
        handedOver: 1,
        waitingTime: { minutes: 5 },
        pickupTime: { minutes: 15 },
      });
    await see
      .comparison({ day: "Samstag", crew: "A" })
      .row("flammkuchen")
      .has({ handedOver: 0, waitingTime: "none", pickupTime: "none" });
  },
);

scenario(
  "the Vergleich sums a crew's shifts over all Kirbe days, averaging the waiting time over every plate",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 11:00");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Samstag 11:04");
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Sonntag 16:00");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Sonntag 16:10");
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    await see
      .comparison({ crew: "A" })
      .row("braten")
      .has({ handedOver: 2, waitingTime: { minutes: 7 } });
    await see
      .comparison({ crew: "B" })
      .row("braten")
      .has({ handedOver: 0, waitingTime: "none" });
  },
);

scenario(
  "the Vergleich totals every product per column",
  async ({ staff, see, time }) => {
    await time.isNow("Samstag 11:00");
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Samstag 11:04");
    await staff.handOver({ pager: 7, plates: { braten: 1 } });
    await time.isNow("Samstag 12:00");
    await staff.takeOrder({ pager: 7, plates: { pommes: 1 } });
    await time.isNow("Samstag 12:02");
    await staff.handOver({ pager: 7, plates: { pommes: 1 } });
    await see
      .comparison({ crew: "A" })
      .total()
      .has({ handedOver: 2, waitingTime: { minutes: 3 } });
    await see
      .comparison({ crew: "B" })
      .total()
      .has({ handedOver: 0, waitingTime: "none" });
  },
);
