"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { failedSignal, MODEL, triageBatch } from "@/lib/agent";
import { expandDateTokens, parseBatch } from "@/lib/batch";
import { daysBetween, TODAY } from "@/lib/dates";
import { listOpenOrders, listProducers, listProducts } from "@/lib/store";
import type { Conflict, Message, Signal, Tier, Triage } from "@/lib/types";

export type AffectedOrder = {
  id: string;
  productName: string;
  quantity: number;
  promisedDispatchDate: string;
  daysToDispatch: number;
};

export type TriageResult = {
  message: Message;
  producerName: string;
  tier: Tier;
  signal: Signal;
  orders: AffectedOrder[];
};

export type InboxState =
  | { status: "idle" }
  | { status: "error"; errors: string[]; text: string }
  | { status: "done"; results: TriageResult[]; conflicts: Conflict[]; model: string; text: string };

const TRIAGE_ORDER: Record<Triage, number> = { ACT_TODAY: 0, MONITOR: 1, NO_CHANGE: 2 };

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Server actions return errors as values: a thrown error reaches the browser as the generic
// Next.js error page in production, with the message stripped.
export async function runTriage(prev: InboxState, formData: FormData): Promise<InboxState> {
  const text = String(formData.get("batch") ?? "");
  try {
    return await triage(text);
  } catch (e) {
    console.error("runTriage failed", e);
    return { status: "error", errors: [`Triage failed before any results came back: ${describe(e)}`], text };
  }
}

async function triage(text: string): Promise<InboxState> {
  const [producers, products, orders] = await Promise.all([listProducers(), listProducts(), listOpenOrders()]);
  const { messages, errors } = parseBatch(text, producers);
  if (errors.length) return { status: "error", errors, text };

  const { signals, conflicts } = await triageBatch(messages);
  const producerById = new Map(producers.map((p) => [p.id, p]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const now = TODAY;

  // One message that cannot be turned into a result becomes an error row, not a failed request.
  const results: TriageResult[] = signals.map((signal, i) => {
    const message = messages[i];
    const producer = producerById.get(message.producerId);
    const base = { message, producerName: producer?.name ?? message.producerId, tier: producer?.tier ?? ("C" as Tier) };
    try {
      return { ...base, signal, orders: affectedOrders(signal) };
    } catch (e) {
      console.error(`Could not build the result for ${message.id}`, e);
      return { ...base, signal: failedSignal(message.id, `could not build the result (${describe(e)})`), orders: [] };
    }
  });

  function affectedOrders(signal: Signal): AffectedOrder[] {
    return signal.affectedOrderIds.flatMap((id) => {
        const o = orderById.get(id);
        if (!o) return [];
        return [
          {
            id,
            productName: productById.get(o.productId)?.name ?? o.productId,
            quantity: o.quantity,
            promisedDispatchDate: o.promisedDispatchDate,
            daysToDispatch: daysBetween(now, o.promisedDispatchDate),
          },
        ];
    });
  }

  // ACT_TODAY first; within a level, the order closest to its promise first.
  const soonest = (r: TriageResult) => Math.min(Infinity, ...r.orders.map((o) => o.daysToDispatch));
  results.sort(
    (a, b) =>
      TRIAGE_ORDER[a.signal.triage] - TRIAGE_ORDER[b.signal.triage] ||
      soonest(a) - soonest(b) ||
      a.message.id.localeCompare(b.message.id),
  );
  return { status: "done", results, conflicts, model: MODEL, text };
}

export async function loadEvalBatch(): Promise<{ text: string } | { error: string }> {
  try {
    const raw = await readFile(path.join(process.cwd(), "eval", "messages.txt"), "utf8");
    return { text: expandDateTokens(raw) };
  } catch (e) {
    console.error("loadEvalBatch failed", e);
    return { error: `Could not load the eval batch from eval/messages.txt (${describe(e)}). You can still paste messages in.` };
  }
}
