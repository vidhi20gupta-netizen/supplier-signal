// Domain types. See PROJECT.md for what tiers and triage mean.

export type Tier = "A" | "B" | "C";

export type Material = "walnut" | "mango wood" | "brass" | "cane" | "cotton" | "ceramic";

export type Producer = {
  id: string;
  name: string;
  tier: Tier;
  /** Share of orders dispatched on or before the promised date, 0–1. */
  onTimeRate: number;
  /** Share of units rejected for quality, 0–1. */
  defectRate: number;
  /** Gap between declared and delivered capacity, as a share of declared, 0–1. */
  capacityVariance: number;
  declaredWeeklyUnits: number;
  materialsUsed: Material[];
};

export type Product = {
  id: string;
  name: string;
  category: string;
  materials: Material[];
  basePriceEur: number;
  /** Working days from order to dispatch, 2–5. */
  dispatchDays: number;
};

export type OrderStatus = "OPEN" | "AT_RISK" | "PARTIAL" | "CANCELLED" | "DISPATCHED";

export type Order = {
  /** Format SS-NNNN. */
  id: string;
  productId: string;
  producerId: string;
  quantity: number;
  /** ISO timestamp. */
  orderedAt: string;
  /** Calendar date, YYYY-MM-DD. */
  promisedDispatchDate: string;
  /** Calendar date, YYYY-MM-DD. */
  promisedDeliveryDate: string;
  status: OrderStatus;
  riskReason: string | null;
};

export type Channel = "WHATSAPP" | "SMS";

export type Message = {
  id: string;
  producerId: string;
  /** ISO timestamp. */
  receivedAt: string;
  channel: Channel;
  /** Raw text exactly as the producer sent it. */
  body: string;
};

export type ChangeType = "LATE" | "PARTIAL" | "CANCELLED" | "CAPACITY_CONSTRAINT" | "QUALITY" | "NONE";

export type Triage = "ACT_TODAY" | "MONITOR" | "NO_CHANGE";

export type Signal = {
  messageId: string;
  affectedOrderIds: string[];
  changeType: ChangeType;
  /** Calendar date, YYYY-MM-DD. */
  newDispatchDate: string | null;
  quantityAffected: number | null;
  materialsBlocked: Material[];
  /** Calendar date, YYYY-MM-DD. */
  blockedUntil: string | null;
  triage: Triage;
  reasoning: string;
  /** 0–1. */
  confidence: number;
  /** What the message says about each open order it mentions or affects. Feeds reconciliation. */
  orderReports: OrderReport[];
};

export type OrderReport = {
  orderId: string;
  /** AT_RISK for every order in affectedOrderIds; READY for orders reported packed, ready or finished with nothing holding dispatch. */
  state: "AT_RISK" | "READY";
  /** A few words, e.g. "brass blocked", "ready for pickup". */
  summary: string;
};

/** One order that this batch reports both as unable to ship and as ready. Never resolved automatically. */
export type Conflict = {
  orderId: string;
  cannotShip: { messageId: string; summary: string }[];
  ready: { messageId: string; summary: string }[];
  /** e.g. "SS-1056: M-07 reports brass blocked, M-20 reports ready for pickup. Confirm which is current." */
  statement: string;
  triage: "ACT_TODAY";
  reason: "conflicting reports in this batch";
};

/** Urgency facts computed in code for each open order. The model reads these, never derives them. */
export type OrderFlags = {
  /** Whole days from TODAY to the promised dispatch date; negative once past. */
  daysRemaining: number;
  /** daysRemaining <= 2. */
  withinActionWindow: boolean;
  /** The product's make time minus days elapsed since the order was placed, floored at 0. */
  remainingMakeTime: number;
  /** daysRemaining >= remainingMakeTime. */
  feasible: boolean;
};

/** Orders still waiting to be made or dispatched. */
export const OPEN_STATUSES: OrderStatus[] = ["OPEN", "AT_RISK", "PARTIAL"];
