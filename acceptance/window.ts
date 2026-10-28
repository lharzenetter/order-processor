import type { ProductId } from "../src/core";

// Every call is async so a Playwright driver can sit behind the same interface (#5).

/** Plates per product, as on a meal voucher or in the Ausgabe stepper. */
export type Plates = Partial<Readonly<Record<ProductId, number>>>;

/** What window staff do. Each step names an order by its pager only (#6). */
export interface Staff {
  takeOrder(order: { pager: number; plates: Plates }): Promise<void>;
  /** One plate per tap on "Pager N rufen", or every waiting plate with "Alle". */
  buzz(buzz: {
    pager: number;
    product: ProductId;
    count?: number | "all";
  }): Promise<void>;
  handOver(handover: { pager: number; plates: Plates }): Promise<void>;
  /** "Weitergeben" in the order popup: one buzzed plate goes to whoever the button names. */
  handOn(handOn: { from: number; product: ProductId }): Promise<void>;
  /** "Zurück in Warteschlange" in the order popup: one buzzed plate. */
  sendBackToQueue(line: { pager: number; product: ProductId }): Promise<void>;
  /** "Nochmal rufen" on the line in the buzzed list. */
  rebuzz(line: { pager: number; product: ProductId }): Promise<void>;
  /** "1 … stornieren" in the order popup, tapped `count` times: waiting plates only. */
  cancel(cancel: {
    pager: number;
    product: ProductId;
    count: number;
  }): Promise<void>;
  /** Taps a product that is not sold out in the Ausverkauft markieren dialog. */
  markSoldOut(product: ProductId): Promise<void>;
  /** Taps a sold-out product in the Ausverkauft markieren dialog. */
  clearSoldOut(product: ProductId): Promise<void>;
  /** "Verwaiste Bestellung schließen…" in the order popup, then "Pager ist zurück" or "Pager fehlt". */
  abandonOrder(abandon: { pager: number; pagerBack: boolean }): Promise<void>;
  /** Taps a free pager in intake's "Pager fehlt…" mode. */
  markPagerMissing(pager: number): Promise<void>;
  /** Taps a missing (dashed) pager in intake's "Pager fehlt…" mode. */
  restorePager(pager: number): Promise<void>;
}

/** A span of time as staff read it on a clock, "m:ss"; compared exactly (#8). */
export interface Duration {
  minutes?: number;
  seconds?: number;
}

/** A line as the order popup shows it; fields left out are not checked (#7). */
export interface LineSeen {
  buzzed?: number;
  waiting?: number;
}

export interface OrderSeen {
  /** Partial: only the named products and fields are checked. */
  has(lines: Partial<Readonly<Record<ProductId, LineSeen>>>): Promise<void>;
  /** Exact: every open line of the order is named, and a count left out is none. */
  hasOnly(lines: Partial<Readonly<Record<ProductId, LineSeen>>>): Promise<void>;
  /** The board offers no "Pager N rufen" for this order and product. */
  cannotBuzz(product: ProductId): Promise<void>;
  /** The Ausgabe stepper stops short of these plates. */
  cannotHandOver(plates: Plates): Promise<void>;
  /** The order popup offers no "Weitergeben" for this product, or only disabled. */
  cannotHandOn(product: ProductId): Promise<void>;
  /** The order popup offers no "1 … stornieren" for this product. */
  cannotCancel(product: ProductId): Promise<void>;
}

export interface PagerSeen {
  isWithTheGuest(): Promise<void>;
  isFree(): Promise<void>;
  /** The intake grid shows the pager dashed: "fehlt". */
  isMissing(): Promise<void>;
}

/** One line of the buzzed list. */
export interface BuzzedLineSeen {
  pager: number;
  product: ProductId;
  plates?: number;
  /** The clock on the line: the time since its buzz. */
  since?: Duration;
}

/** A line of the buzzed list, named by its pager and product. */
export interface BuzzedLineRef {
  pager: number;
  product: ProductId;
}

export interface BuzzedListSeen {
  /** Exact and in order: the earliest buzz first. */
  lists(lines: readonly BuzzedLineSeen[]): Promise<void>;
  includes(line: BuzzedLineSeen): Promise<void>;
  isEmpty(): Promise<void>;
  /** The line is highlighted: "nochmal rufen". */
  rebuzzDueFor(line: BuzzedLineRef): Promise<void>;
  noRebuzzDueFor(line: BuzzedLineRef): Promise<void>;
}

/** A product's row on the board (Übersicht). */
export interface BoardRowSeen {
  /**
   * Partial: `next` is the pager on "Pager N rufen", `queued` the pagers behind it
   * ("danach"), exact and in FIFO order.
   */
  has(row: { next?: number; queued?: readonly number[] }): Promise<void>;
  /** The row reads "niemand wartet". */
  nobodyWaits(): Promise<void>;
  /** The row carries the sold-out tag. */
  isSoldOut(): Promise<void>;
  isNotSoldOut(): Promise<void>;
}

/** An open order on a sold-out product's banner: its pager chip, "Pager N ×plates". */
export interface SoldOutOrderSeen {
  pager: number;
  plates?: number;
}

/** A sold-out product's banner over the board. */
export interface SoldOutSeen {
  /** Exact and in FIFO order: the open orders still waiting for the product. */
  lists(orders: readonly SoldOutOrderSeen[]): Promise<void>;
  /** The banner reads "niemand wartet". */
  nobodyWaits(): Promise<void>;
}

/** One entry of the Offene Bestellungen list: "Pager N: 2× Braten (1 gerufen), …". */
export interface OpenOrderSeen {
  pager: number;
  /** Exact: every line still owed is named, and a count left out is none. */
  lines: Partial<Readonly<Record<ProductId, LineSeen>>>;
}

/** The Offene Bestellungen list in the Verwaltung, the paper fallback. */
export interface OpenOrdersListSeen {
  /** Exact and sorted by pager: every open order. */
  lists(orders: readonly OpenOrderSeen[]): Promise<void>;
}

export interface IntakeSeen {
  refusesPager(pager: number): Promise<void>;
  acceptsPager(pager: number): Promise<void>;
  /** Tapping the product asks "… ist ausverkauft" before entering it. */
  warnsSoldOut(product: ProductId): Promise<void>;
  noSoldOutWarningFor(product: ProductId): Promise<void>;
}

/** What window staff see. Nothing here reaches past the screen (#7). */
export interface See {
  /** The open order on this pager, as the Ausgabe popup shows it. */
  order(order: { pager: number }): OrderSeen;
  pager(pager: number): PagerSeen;
  buzzedList(): BuzzedListSeen;
  board(product: ProductId): BoardRowSeen;
  /** The banner a sold-out product shows; fails if the product is not sold out. */
  soldOut(product: ProductId): SoldOutSeen;
  openOrdersList(): OpenOrdersListSeen;
  intake(): IntakeSeen;
}

export interface Time {
  passes(duration: Duration): Promise<void>;
}

export interface Window {
  readonly staff: Staff;
  readonly see: See;
  readonly time: Time;
}
