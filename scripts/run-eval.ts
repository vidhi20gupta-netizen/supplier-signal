// Runs the triage agent on eval/messages.txt and prints every result.
// Usage: npm run eval:run   (reads ANTHROPIC_API_KEY from .env.local)
import { readFileSync } from "node:fs";
import { computeOrderFlags, MODEL, triageBatch } from "../lib/agent";
import { parseBatch } from "../lib/batch";
import { TODAY } from "../lib/dates";
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

  console.log(`Model ${MODEL} · prompt ${PROMPT_VERSION} · TODAY ${TODAY}${process.env.EVAL_TODAY ? " (pinned by EVAL_TODAY)" : ""} · ${messages.length} messages\n`);
  const started = Date.now();
  const { signals, conflicts } = await triageBatch(messages);

  console.log(`CONFLICTS (${conflicts.length}) · ACT_TODAY · conflicting reports in this batch`);
  for (const c of conflicts) console.log(`  ${c.statement}`);
  if (conflicts.length === 0) console.log("  none");
  console.log("");

  signals.forEach((s, i) => {
    const m = messages[i];
    const p = producerById.get(m.producerId)!;
    console.log(`━━ ${m.id} · ${p.name} (tier ${p.tier}) · ${m.channel}`);
    console.log(`   "${m.body.replace(/\s+/g, " ")}"`);
    console.log(`   triage ${s.triage} · ${s.changeType} · confidence ${s.confidence}`);
    if (s.affectedOrderIds.length === 0) console.log("   orders: none");
    for (const id of s.affectedOrderIds) {
      const o = orderById.get(id)!;
      const f = computeOrderFlags(o, productById.get(o.productId));
      console.log(
        `   order ${id} · ${productById.get(o.productId)?.name} ×${o.quantity} · promised ${o.promisedDispatchDate} · daysRemaining=${f.daysRemaining} withinActionWindow=${f.withinActionWindow} feasible=${f.feasible}`,
      );
    }
    const extras = [
      s.newDispatchDate && `new dispatch ${s.newDispatchDate}`,
      s.quantityAffected != null && `qty affected ${s.quantityAffected}`,
      s.materialsBlocked.length > 0 && `blocked ${s.materialsBlocked.join(", ")}`,
      s.blockedUntil && `until ${s.blockedUntil}`,
    ].filter(Boolean);
    if (extras.length) console.log(`   ${extras.join(" · ")}`);
    if (s.orderReports.length) {
      console.log(`   reports: ${s.orderReports.map((r) => `${r.orderId} ${r.state} "${r.summary}"`).join(" · ")}`);
    }
    console.log(`   reasoning: ${s.reasoning}\n`);
  });

  const count = (t: string) => signals.filter((s) => s.triage === t).length;
  const failures = signals.filter((s) => s.confidence === 0 && s.reasoning.startsWith("Automatic triage failed")).length;
  console.log(
    `conflicts ${conflicts.length} · ACT_TODAY ${count("ACT_TODAY")} · MONITOR ${count("MONITOR")} · NO_CHANGE ${count("NO_CHANGE")} · failed ${failures} · ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main();
