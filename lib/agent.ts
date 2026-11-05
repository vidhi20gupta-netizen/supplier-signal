// Triage agent: one Claude call per message, forced through the record_signal tool so the output
// is structured. triageBatch never throws for a single message: anything it cannot read comes back
// as ACT_TODAY, because a message we could not read is a message a human must read.
// After extraction, a reconciliation pass finds orders the batch contradicts itself about.
import Anthropic from "@anthropic-ai/sdk";
import { daysBetween, toDateString, TODAY } from "./dates";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { listOpenOrders, listProducers, listProducts } from "./store";
import type { ChangeType, Conflict, Material, Message, Order, OrderFlags, OrderReport, Product, Signal, Triage } from "./types";

export const MODEL = "claude-sonnet-4-5";
// Calls in flight at once. Kept small to stay clear of API rate limits.
const CONCURRENCY = 6;

const CHANGE_TYPES: ChangeType[] = ["LATE", "PARTIAL", "CANCELLED", "CAPACITY_CONSTRAINT", "QUALITY", "NONE"];
const TRIAGES: Triage[] = ["ACT_TODAY", "MONITOR", "NO_CHANGE"];
const MATERIALS: Material[] = ["walnut", "mango wood", "brass", "cane", "cotton", "ceramic"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Mirrors Signal minus messageId, which the code fills in. Reasoning comes first so the model
// writes it before committing to the decisions.
const RECORD_SIGNAL: Anthropic.Tool = {
  name: "record_signal",
  description: "Record the triage decision for the message being triaged. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      reasoning: { type: "string" },
      affectedOrderIds: { type: "array", items: { type: "string" } },
      changeType: { type: "string", enum: CHANGE_TYPES },
      newDispatchDate: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
      quantityAffected: { type: ["integer", "null"] },
      materialsBlocked: { type: "array", items: { type: "string", enum: MATERIALS } },
      blockedUntil: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
      triage: { type: "string", enum: TRIAGES },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      orderReports: {
        type: "array",
        items: {
          type: "object",
          properties: {
            orderId: { type: "string" },
            state: { type: "string", enum: ["AT_RISK", "READY"] },
            summary: { type: "string" },
          },
          required: ["orderId", "state", "summary"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "reasoning",
      "affectedOrderIds",
      "changeType",
      "newDispatchDate",
      "quantityAffected",
      "materialsBlocked",
      "blockedUntil",
      "triage",
      "confidence",
      "orderReports",
    ],
    additionalProperties: false,
  },
};

class TriageFailure extends Error {}

/** The row returned for a message that could not be triaged: always ACT_TODAY, confidence 0. */
export function failedSignal(messageId: string, why: string): Signal {
  return {
    messageId,
    affectedOrderIds: [],
    changeType: "NONE",
    newDispatchDate: null,
    quantityAffected: null,
    materialsBlocked: [],
    blockedUntil: null,
    triage: "ACT_TODAY",
    reasoning: `Automatic triage failed: ${why}. A human must read this message.`,
    confidence: 0,
    orderReports: [],
  };
}

/** Checks the tool input against the Signal shape. Throws TriageFailure on anything malformed. */
function toSignal(messageId: string, input: unknown, openOrderIds: Set<string>): Signal {
  const bad = (field: string) => new TriageFailure(`model returned an invalid ${field}`);
  if (typeof input !== "object" || input === null) throw bad("tool input");
  const i = input as Record<string, unknown>;

  if (typeof i.reasoning !== "string" || !i.reasoning.trim()) throw bad("reasoning");
  if (!Array.isArray(i.affectedOrderIds) || !i.affectedOrderIds.every((x) => typeof x === "string")) {
    throw bad("affectedOrderIds");
  }
  if (!CHANGE_TYPES.includes(i.changeType as ChangeType)) throw bad("changeType");
  if (!TRIAGES.includes(i.triage as Triage)) throw bad("triage");
  if (i.newDispatchDate !== null && !(typeof i.newDispatchDate === "string" && DATE.test(i.newDispatchDate))) {
    throw bad("newDispatchDate");
  }
  if (i.blockedUntil !== null && !(typeof i.blockedUntil === "string" && DATE.test(i.blockedUntil))) {
    throw bad("blockedUntil");
  }
  if (i.quantityAffected !== null && !Number.isInteger(i.quantityAffected)) throw bad("quantityAffected");
  if (!Array.isArray(i.materialsBlocked) || !i.materialsBlocked.every((m) => MATERIALS.includes(m as Material))) {
    throw bad("materialsBlocked");
  }
  if (typeof i.confidence !== "number" || i.confidence < 0 || i.confidence > 1) throw bad("confidence");
  const isReport = (r: unknown): r is OrderReport => {
    const x = r as Record<string, unknown>;
    return (
      typeof x === "object" && x !== null && typeof x.orderId === "string" &&
      (x.state === "AT_RISK" || x.state === "READY") && typeof x.summary === "string"
    );
  };
  if (!Array.isArray(i.orderReports) || !i.orderReports.every(isReport)) throw bad("orderReports");

  // An order id the model made up, or one that is not open, must not reach the review queue
  // looking like a match. Drop it and say so.
  const ids = i.affectedOrderIds as string[];
  const unknown = ids.filter((id) => !openOrderIds.has(id));
  let reasoning = i.reasoning;
  if (unknown.length) {
    reasoning += ` [Removed by validation: ${unknown.join(", ")} not in the open-order list.]`;
  }

  return {
    messageId,
    affectedOrderIds: [...new Set(ids.filter((id) => openOrderIds.has(id)))],
    changeType: i.changeType as ChangeType,
    newDispatchDate: i.newDispatchDate as string | null,
    quantityAffected: i.quantityAffected as number | null,
    materialsBlocked: i.materialsBlocked as Material[],
    blockedUntil: i.blockedUntil as string | null,
    triage: i.triage as Triage,
    reasoning,
    confidence: i.confidence,
    orderReports: (i.orderReports as OrderReport[])
      .filter((r) => openOrderIds.has(r.orderId))
      // Summaries are joined with commas in conflict statements, so a comma inside one reads as a new report.
      .map((r) => ({ ...r, summary: r.summary.trim().replace(/\.$/, "").replace(/\s*[,;]\s*/g, " and ") })),
  };
}

const FALLBACK_SUMMARY: Record<ChangeType, string> = {
  LATE: "a delay",
  PARTIAL: "a partial shipment",
  CANCELLED: "it cannot be made",
  CAPACITY_CONSTRAINT: "a capacity constraint",
  QUALITY: "a quality problem",
  NONE: "no change",
};

/**
 * Messages are extracted independently, so a batch can contradict itself about an order. An order
 * is in conflict when one message says it cannot ship (it is in that message's affectedOrderIds)
 * and another says it is ready (a READY report). No side wins: every such order becomes a Conflict,
 * and every signal that lists it as affected is raised to ACT_TODAY.
 */
export function reconcile(messages: Message[], signals: Signal[]): { signals: Signal[]; conflicts: Conflict[] } {
  type Side = { messageId: string; summary: string; index: number };
  const byOrder = new Map<string, { cannotShip: Side[]; ready: Side[] }>();
  const sides = (orderId: string) => {
    if (!byOrder.has(orderId)) byOrder.set(orderId, { cannotShip: [], ready: [] });
    return byOrder.get(orderId)!;
  };

  signals.forEach((s, index) => {
    const messageId = messages[index].id;
    const summaryFor = (orderId: string, state: OrderReport["state"]) =>
      s.orderReports.find((r) => r.orderId === orderId && r.state === state)?.summary || null;
    if (s.changeType !== "NONE") {
      for (const orderId of s.affectedOrderIds) {
        sides(orderId).cannotShip.push({ messageId, index, summary: summaryFor(orderId, "AT_RISK") ?? FALLBACK_SUMMARY[s.changeType] });
      }
    }
    for (const r of s.orderReports) {
      // A message that both holds and readies an order (a partial) is not a conflict with itself.
      if (r.state === "READY" && !s.affectedOrderIds.includes(r.orderId)) {
        sides(r.orderId).ready.push({ messageId, index, summary: r.summary || "ready" });
      }
    }
  });

  const conflicts: Conflict[] = [...byOrder.entries()]
    .filter(([, x]) => x.cannotShip.length > 0 && x.ready.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([orderId, x]) => {
      const strip = ({ messageId, summary }: Side) => ({ messageId, summary });
      const reports = [...x.cannotShip, ...x.ready].map((r) => `${r.messageId} reports ${r.summary}`);
      return {
        orderId,
        cannotShip: x.cannotShip.map(strip),
        ready: x.ready.map(strip),
        statement: `${orderId}: ${reports.join(", ")}. Confirm which is current.`,
        triage: "ACT_TODAY",
        reason: "conflicting reports in this batch",
      };
    });

  const reconciled = signals.map((s, index) => {
    const messageId = messages[index].id;
    const notes: string[] = [];
    let triage = s.triage;
    for (const c of conflicts) {
      const others = [...c.cannotShip, ...c.ready].map((r) => r.messageId).filter((id) => id !== messageId);
      if (s.affectedOrderIds.includes(c.orderId) && c.cannotShip.some((r) => r.messageId === messageId)) {
        triage = "ACT_TODAY";
        notes.push(`${c.orderId} is ACT_TODAY: conflicting reports in this batch (also ${others.join(", ")}).`);
      } else if (c.ready.some((r) => r.messageId === messageId)) {
        notes.push(`${c.orderId} conflicts with ${others.join(", ")} in this batch.`);
      }
    }
    if (!notes.length) return s;
    return { ...s, triage, reasoning: `${s.reasoning} [Reconciliation: ${notes.join(" ")}]` };
  });

  return { signals: reconciled, conflicts };
}

function describeError(e: unknown): string {
  if (e instanceof TriageFailure) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Anthropic API rejected the credentials (401)";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic API rate limit (429) after retries";
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status ?? ""}: ${e.message}`.trim();
  if (e instanceof Error) return e.message;
  return String(e);
}

export const ACTION_WINDOW_DAYS = 2;

/**
 * Urgency is computed here, not by the model. Production is assumed to start on the order date:
 * orders record no progress, so elapsed production is the time since orderedAt.
 */
export function computeOrderFlags(order: Order, product: Product | undefined): OrderFlags {
  const daysRemaining = daysBetween(TODAY, order.promisedDispatchDate);
  const elapsed = Math.max(0, daysBetween(toDateString(new Date(order.orderedAt)), TODAY));
  const remainingMakeTime = Math.max(0, (product?.dispatchDays ?? 0) - elapsed);
  return {
    daysRemaining,
    withinActionWindow: daysRemaining <= ACTION_WINDOW_DAYS,
    remainingMakeTime,
    feasible: daysRemaining >= remainingMakeTime,
  };
}

export type TriageRun = {
  /** One per message, in the same order, after reconciliation. */
  signals: Signal[];
  conflicts: Conflict[];
};

/** Triage one morning batch: extract every message, then reconcile across the batch. */
export async function triageBatch(messages: Message[]): Promise<TriageRun> {
  const [orders, products, producers] = await Promise.all([listOpenOrders(), listProducts(), listProducers()]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const openOrders = orders.map((o) => ({ ...o, ...computeOrderFlags(o, productById.get(o.productId)) }));
  const openOrderIds = new Set(openOrders.map((o) => o.id));
  const producerById = new Map(producers.map((p) => [p.id, p]));

  // Identical for every message in the batch, so it is cached after the first call.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: buildSystemPrompt({ today: TODAY, openOrders, products, producers, batch: messages }),
      cache_control: { type: "ephemeral" },
    },
  ];

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch (e) {
    const signals = messages.map((m) => failedSignal(m.id, `could not create the Anthropic client (${describeError(e)})`));
    return { signals, conflicts: [] };
  }

  async function triageOne(message: Message): Promise<Signal> {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system,
        tools: [RECORD_SIGNAL],
        tool_choice: { type: "tool", name: RECORD_SIGNAL.name },
        messages: [{ role: "user", content: buildUserPrompt(message, producerById.get(message.producerId) ?? null) }],
      });
      if (response.stop_reason === "max_tokens") throw new TriageFailure("response was cut off at max_tokens");
      if (response.stop_reason === "refusal") throw new TriageFailure("the model declined to answer");
      const call = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === RECORD_SIGNAL.name,
      );
      if (!call) throw new TriageFailure("model did not call record_signal");
      return toSignal(message.id, call.input, openOrderIds);
    } catch (e) {
      return failedSignal(message.id, describeError(e));
    }
  }

  const results: Signal[] = new Array(messages.length);
  if (messages.length === 0) return { signals: [], conflicts: [] };
  // No solo warm-up call: the first wave of CONCURRENCY calls each writes the prompt cache, which
  // costs a little more than one write but saves a whole call's latency on every batch.
  let next = 0;
  async function worker() {
    while (next < messages.length) {
      const index = next++;
      results[index] = await triageOne(messages[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, messages.length) }, worker));
  return reconcile(messages, results);
}
