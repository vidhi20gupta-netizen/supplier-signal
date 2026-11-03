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
};

/** Orders still waiting to be made or dispatched. */
export const OPEN_STATUSES: OrderStatus[] = ["OPEN", "AT_RISK", "PARTIAL"];
