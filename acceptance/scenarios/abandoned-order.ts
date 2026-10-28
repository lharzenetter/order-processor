import { scenario } from "../scenario";

// #18
scenario(
  "closing an abandoned order with its pager back frees the pager",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 2, pommes: 1 } });
    await staff.takeOrder({ pager: 9, plates: { braten: 1 } });
    await staff.buzz({ pager: 7, product: "braten" });
    await staff.abandonOrder({ pager: 7, pagerBack: true });
    await see.buzzedList().isEmpty();
    await see.board("braten").has({ next: 9, queued: [] });
    await see.board("pommes").nobodyWaits();
    await see.pager(7).isFree();
    await see.intake().acceptsPager(7);
  },
);

// #18
scenario(
  "closing an abandoned order without its pager marks the pager missing",
  async ({ staff, see }) => {
    await staff.takeOrder({ pager: 7, plates: { braten: 1 } });
    await staff.abandonOrder({ pager: 7, pagerBack: false });
    await see.pager(7).isMissing();
    await see.board("braten").nobodyWaits();
  },
);

// #18
scenario(
  "a pager marked missing is free again once restored",
  async ({ staff, see }) => {
    await staff.markPagerMissing(23);
    await see.pager(23).isMissing();
    await staff.restorePager(23);
    await see.pager(23).isFree();
  },
);

// 05-exceptions: a pager that turned up again is restored when an order is started on it
scenario(
  "taking an order on a missing pager puts it back in use",
  async ({ staff, see }) => {
    await staff.markPagerMissing(23);
    await see.intake().acceptsPager(23);
    await staff.takeOrder({ pager: 23, plates: { pommes: 1 } });
    await see.pager(23).isWithTheGuest();
    await staff.handOver({ pager: 23, plates: { pommes: 1 } });
    await see.pager(23).isFree();
  },
);
