// Triage agent: one Claude call per message, forced through the record_signal tool so the output
// is structured. triageBatch never throws for a single message: anything it cannot read comes back
// as ACT_TODAY, because a message we could not read is a message a human must read.
import Anthropic from "@anthropic-ai/sdk";
import { daysBetween, today } from "./dates";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { listOpenOrders, listProducers, listProducts } from "./store";
import type { ChangeType, Material, Message, Signal, Triage } from "./types";

export const MODEL = "claude-sonnet-4-5";
const CONCURRENCY = 5;

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
    ],
    additionalProperties: false,
  },
};

class TriageFailure extends Error {}

function failed(messageId: string, why: string): Signal {
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
  };
}

function describeError(e: unknown): string {
  if (e instanceof TriageFailure) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Anthropic API rejected the credentials (401)";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic API rate limit (429) after retries";
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status ?? ""}: ${e.message}`.trim();
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Triage one morning batch. Returns one Signal per message, in the same order. */
export async function triageBatch(messages: Message[]): Promise<Signal[]> {
  const [orders, products, producers] = await Promise.all([listOpenOrders(), listProducts(), listProducers()]);
  const now = today();
  const openOrders = orders.map((o) => ({ ...o, daysToDispatch: daysBetween(now, o.promisedDispatchDate) }));
  const openOrderIds = new Set(openOrders.map((o) => o.id));
  const producerById = new Map(producers.map((p) => [p.id, p]));

  // Identical for every message in the batch, so it is cached after the first call.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: buildSystemPrompt({ today: now, openOrders, products, producers, batch: messages }),
      cache_control: { type: "ephemeral" },
    },
  ];

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch (e) {
    return messages.map((m) => failed(m.id, `could not create the Anthropic client (${describeError(e)})`));
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
      return failed(message.id, describeError(e));
    }
  }

  const results: Signal[] = new Array(messages.length);
  if (messages.length === 0) return results;
  // Run the first message alone so it writes the prompt cache before the rest read it.
  results[0] = await triageOne(messages[0]);
  let next = 1;
  async function worker() {
    while (next < messages.length) {
      const index = next++;
      results[index] = await triageOne(messages[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, messages.length) }, worker));
  return results;
}
