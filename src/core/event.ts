/** What the ui/storage side stamps on every event before it is appended; the core never stamps. */
export interface Stamp {
  /** A UUID; an order is identified by the `id` of its `orderTaken`. */
  readonly id: string;
  /** Strictly increasing within the log; an order's FIFO place is its `orderTaken`'s `seq`. */
  readonly seq: number;
  /** Wall-clock milliseconds. */
  readonly at: number;
  /** The device name of the iPad that tapped, in sync mode; captured at the tap. */
  readonly device?: string;
}

export interface PlateCount {
  readonly productId: string;
  readonly count: number;
}

/** A state change as the window staff made it, before it is stamped. */
export type EventBody =
  | {
      readonly type: "orderTaken";
      readonly pager: number;
      readonly plates: readonly PlateCount[];
    }
  | {
      readonly type: "platesBuzzed";
      readonly orderId: string;
      readonly productId: string;
      readonly count: number;
    }
  | {
      readonly type: "plateHandedOn";
      readonly fromOrderId: string;
      readonly toOrderId: string;
      readonly productId: string;
    }
  | {
      readonly type: "plateSentBackToQueue";
      readonly orderId: string;
      readonly productId: string;
    }
  | {
      readonly type: "rebuzzed";
      readonly orderId: string;
      readonly productId: string;
    }
  | {
      readonly type: "platesHandedOver";
      readonly orderId: string;
      readonly plates: readonly PlateCount[];
    }
  | {
      readonly type: "platesCancelled";
      readonly orderId: string;
      readonly productId: string;
      readonly count: number;
    }
  | {
      readonly type: "orderAbandoned";
      readonly orderId: string;
      readonly pagerBack: boolean;
    }
  | { readonly type: "pagerMarkedMissing"; readonly pager: number }
  | { readonly type: "pagerRestored"; readonly pager: number }
  | { readonly type: "soldOutMarked"; readonly productId: string }
  | { readonly type: "soldOutCleared"; readonly productId: string }
  | { readonly type: "actionUndone"; readonly targetId: string };

export type EventType = EventBody["type"];

/** One entry of the append-only event log. */
export type Event = Stamp & EventBody;
