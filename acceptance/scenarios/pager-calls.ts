import { scenario } from "../scenario";

// #23
scenario("automatic pager calls are on in a new event log", async ({ see }) => {
  await see.pagerCalls().areOn();
});

// #23
scenario(
  "switching automatic pager calls on one iPad switches them for every iPad",
  async ({ staff, see }) => {
    await staff.ipad("Links").switchPagerCalls({ on: false });
    await see.pagerCalls().areOff();
    await staff.ipad("Rechts").switchPagerCalls({ on: true });
    await see.pagerCalls().areOn();
  },
);

// #23: undo never turns calls back on while the transmitter is disconnected
scenario(
  "Rückgängig skips the switch and offers the action before it",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await staff.switchPagerCalls({ on: false });
    await see.undo().offers("Neue Bestellung 1× Braten → Pager 7");
    await staff.undo();
    await see.pager(7).isFree();
    await see.pagerCalls().areOff();
    await see.undo().offersNothing();
  },
);

// #23
scenario(
  "with only a switch recorded, Rückgängig has nothing to undo",
  async ({ staff, see }) => {
    await staff.switchPagerCalls({ on: false });
    await see.undo().offersNothing();
  },
);
