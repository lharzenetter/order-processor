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
}

export interface PagerSeen {
  isWithTheGuest(): Promise<void>;
  isFree(): Promise<void>;
}

/** One line of the buzzed list. */
export interface BuzzedLineSeen {
  pager: number;
  product: ProductId;
  plates?: number;
}

export interface BuzzedListSeen {
  /** Exact and in order: the earliest buzz first. */
  lists(lines: readonly BuzzedLineSeen[]): Promise<void>;
  includes(line: BuzzedLineSeen): Promise<void>;
  isEmpty(): Promise<void>;
}

export interface IntakeSeen {
  refusesPager(pager: number): Promise<void>;
  acceptsPager(pager: number): Promise<void>;
}

/** What window staff see. Nothing here reaches past the screen (#7). */
export interface See {
  /** The open order on this pager, as the Ausgabe popup shows it. */
  order(order: { pager: number }): OrderSeen;
  pager(pager: number): PagerSeen;
  buzzedList(): BuzzedListSeen;
  intake(): IntakeSeen;
}

export interface Time {
  passes(duration: { minutes?: number; seconds?: number }): Promise<void>;
}

export interface Window {
  readonly staff: Staff;
  readonly see: See;
  readonly time: Time;
}
