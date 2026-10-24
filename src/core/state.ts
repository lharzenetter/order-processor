import type { Event } from "./event";

/** One order × product. Plates have no identity; a line only counts them. */
export interface Line {
  readonly productId: string;
  readonly ordered: number;
  readonly cancelled: number;
  /** Buzzed and not yet picked up. */
  readonly buzzed: number;
  /** When each buzzed plate was buzzed or handed on to this line, oldest first. */
  readonly buzzedAt: readonly number[];
  readonly pickedUp: number;
  /** Of the picked-up plates, those buzzed before their handover. */
  readonly pickedUpAfterBuzz: number;
  /** The waiting times of the picked-up and abandoned plates, summed. */
  readonly waitingTimeMs: number;
  /** The pickup times of the plates picked up after a buzz, summed. */
  readonly pickupTimeMs: number;
  readonly backToQueue: number;
  readonly abandoned: number;
  /** Set while `buzzed > 0`: when the line's buzz clock started or was last re-buzzed. */
  readonly buzzClockFrom?: number;
}

export type ClosedBy = "handover" | "cancel" | "abandoned";

export interface Order {
  /** The `id` of its `orderTaken`. */
  readonly id: string;
  readonly pager: number;
  /** Its FIFO place: the `seq` of its `orderTaken`. */
  readonly seq: number;
  readonly takenAt: number;
  readonly closedAt?: number;
  readonly closedBy?: ClosedBy;
  /** One per ordered product, in display order. */
  readonly lines: readonly Line[];
}

export interface State {
  /** Open and closed, never deleted, in FIFO order. */
  readonly orders: readonly Order[];
  /** Ascending. */
  readonly missingPagers: readonly number[];
  /** Product ids, in display order. */
  readonly soldOut: readonly string[];
  readonly soldOutFirstAt: Readonly<Record<string, number>>;
  /** The events in force, oldest first: neither undone nor an undo. Undo pops the newest. */
  readonly live: readonly Event[];
}

export const INITIAL_STATE: State = {
  orders: [],
  missingPagers: [],
  soldOut: [],
  soldOutFirstAt: {},
  live: [],
};
