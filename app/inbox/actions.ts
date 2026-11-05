"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { MODEL, triageBatch } from "@/lib/agent";
import { expandDateTokens, parseBatch } from "@/lib/batch";
import { daysBetween, today } from "@/lib/dates";
import { listOpenOrders, listProducers, listProducts } from "@/lib/store";
import type { Message, Signal, Tier, Triage } from "@/lib/types";

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
  | { status: "done"; results: TriageResult[]; model: string; text: string };

const TRIAGE_ORDER: Record<Triage, number> = { ACT_TODAY: 0, MONITOR: 1, NO_CHANGE: 2 };

export async function runTriage(_: InboxState, formData: FormData): Promise<InboxState> {
  const text = String(formData.get("batch") ?? "");
  const [producers, products, orders] = await Promise.all([listProducers(), listProducts(), listOpenOrders()]);
  const { messages, errors } = parseBatch(text, producers);
  if (errors.length) return { status: "error", errors, text };

  const signals = await triageBatch(messages);
  const producerById = new Map(producers.map((p) => [p.id, p]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const now = today();

  const results: TriageResult[] = signals.map((signal, i) => {
    const message = messages[i];
    const producer = producerById.get(message.producerId)!;
    return {
      message,
      producerName: producer.name,
      tier: producer.tier,
      signal,
      orders: signal.affectedOrderIds.flatMap((id) => {
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
      }),
    };
  });

  // ACT_TODAY first; within a level, the order closest to its promise first.
  const soonest = (r: TriageResult) => Math.min(Infinity, ...r.orders.map((o) => o.daysToDispatch));
  results.sort(
    (a, b) =>
      TRIAGE_ORDER[a.signal.triage] - TRIAGE_ORDER[b.signal.triage] ||
      soonest(a) - soonest(b) ||
      a.message.id.localeCompare(b.message.id),
  );
  return { status: "done", results, model: MODEL, text };
}

export async function loadEvalBatch(): Promise<string> {
  const raw = await readFile(path.join(process.cwd(), "eval", "messages.txt"), "utf8");
  return expandDateTokens(raw);
}
