import type { Event, EventType } from "../core/index";

type Field = "string" | "number" | "boolean" | "plates";

// Keyed by every event type, so a type added to the core fails the typecheck here.
const EVENT_FIELDS: Readonly<
  Record<EventType, Readonly<Record<string, Field>>>
> = {
  orderTaken: { pager: "number", plates: "plates" },
  platesBuzzed: { orderId: "string", productId: "string", count: "number" },
  plateHandedOn: {
    fromOrderId: "string",
    toOrderId: "string",
    productId: "string",
  },
  plateSentBackToQueue: { orderId: "string", productId: "string" },
  rebuzzed: { orderId: "string", productId: "string" },
  platesHandedOver: { orderId: "string", plates: "plates" },
  platesCancelled: { orderId: "string", productId: "string", count: "number" },
  orderAbandoned: { orderId: "string", pagerBack: "boolean" },
  pagerMarkedMissing: { pager: "number" },
  pagerRestored: { pager: "number" },
  soldOutMarked: { productId: "string" },
  soldOutCleared: { productId: "string" },
  actionUndone: { targetId: "string" },
};

export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a stored or imported value has the shape of an event; the fold checks the rest. */
export function isEvent(value: unknown): value is Event {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Number.isInteger(value.seq) ||
    typeof value.at !== "number" ||
    !isEventType(value.type)
  ) {
    return false;
  }
  const fields = EVENT_FIELDS[value.type];
  return Object.entries(fields).every(([name, field]) =>
    hasField(value[name], field),
  );
}

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && Object.hasOwn(EVENT_FIELDS, value);
}

function hasField(value: unknown, field: Field): boolean {
  switch (field) {
    case "plates":
      return (
        Array.isArray(value) &&
        value.every(
          (plate) =>
            isRecord(plate) &&
            typeof plate.productId === "string" &&
            typeof plate.count === "number",
        )
      );
    case "string":
    case "number":
    case "boolean":
      return typeof value === field;
  }
}
