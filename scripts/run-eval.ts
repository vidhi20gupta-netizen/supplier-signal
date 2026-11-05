// Runs the triage agent on eval/messages.txt and prints every result.
// Usage: npm run eval:run   (reads ANTHROPIC_API_KEY from .env.local)
import { readFileSync } from "node:fs";
import { MODEL, triageBatch } from "../lib/agent";
import { parseBatch } from "../lib/batch";
import { daysBetween, today } from "../lib/dates";
import { PROMPT_VERSION } from "../lib/prompt";
import { listOpenOrders, listProducers, listProducts } from "../lib/store";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local and run again.");
    process.exit(1);
  }
  const [producers, products, orders] = await Promise.all([listProducers(), listProducts(), listOpenOrders()]);
  const { messages, errors } = parseBatch(readFileSync("eval/messages.txt", "utf8"), producers);
  if (errors.length) {
    console.error("Could not parse eval/messages.txt:\n" + errors.join("\n"));
    process.exit(1);
  }

  const producerById = new Map(producers.map((p) => [p.id, p]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const now = today();

  console.log(`Model ${MODEL} · prompt ${PROMPT_VERSION} · today ${now} · ${messages.length} messages\n`);
  const started = Date.now();
  const signals = await triageBatch(messages);

  signals.forEach((s, i) => {
    const m = messages[i];
    const p = producerById.get(m.producerId)!;
    console.log(`━━ ${m.id} · ${p.name} (tier ${p.tier}) · ${m.channel}`);
    console.log(`   "${m.body.replace(/\s+/g, " ")}"`);
    console.log(`   triage ${s.triage} · ${s.changeType} · confidence ${s.confidence}`);
    if (s.affectedOrderIds.length === 0) console.log("   orders: none");
    for (const id of s.affectedOrderIds) {
      const o = orderById.get(id)!;
      const days = daysBetween(now, o.promisedDispatchDate);
      console.log(`   order ${id} · ${productById.get(o.productId)?.name} ×${o.quantity} · promised ${o.promisedDispatchDate} (${days}d)`);
    }
    const extras = [
      s.newDispatchDate && `new dispatch ${s.newDispatchDate}`,
      s.quantityAffected != null && `qty affected ${s.quantityAffected}`,
      s.materialsBlocked.length > 0 && `blocked ${s.materialsBlocked.join(", ")}`,
      s.blockedUntil && `until ${s.blockedUntil}`,
    ].filter(Boolean);
    if (extras.length) console.log(`   ${extras.join(" · ")}`);
    console.log(`   reasoning: ${s.reasoning}\n`);
  });

  const count = (t: string) => signals.filter((s) => s.triage === t).length;
  const failures = signals.filter((s) => s.confidence === 0 && s.reasoning.startsWith("Automatic triage failed")).length;
  console.log(
    `ACT_TODAY ${count("ACT_TODAY")} · MONITOR ${count("MONITOR")} · NO_CHANGE ${count("NO_CHANGE")} · failed ${failures} · ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main();
