# Supplier Signal

Supplier Signal reads a morning batch of WhatsApp and SMS messages from artisan producers and decides, for each open order, whether to act today, monitor it, or change nothing.

## The problem

Soulspiti is a marketplace where independent artisans make home decor and customers buy it. Every order has to leave the producer within two to five days, and producers report problems in loose WhatsApp and SMS messages, not through any system. A delay or shortage missed in the morning cannot be recovered in the afternoon, because on a window that short the replacement time has already gone. When these signals were missed before, the marketplace kept accepting orders producers could not make, and cancellations reached 25 percent.

## Where the model earns its place

Matching messages to orders is mostly string matching, because producers quote order numbers. The two real claims are:

- **Implied-state extraction.** Reading what changed from how people write: "better give it to someone else" is a cancellation.
- **Cross-referencing constraints.** When a producer reports a material shortage or a full workshop without naming an order, finding every open order it invalidates.

## What run 1 found

Reading 25 outputs against the order book by hand surfaced nine defects. Two were provable without any ground truth, because they were internal contradictions: the same order received two different urgency levels in one run, and one batch produced contradictory conclusions about three orders. Both are now handled in code: date arithmetic and conflict detection no longer happen in the prompt. The full write-up is in [eval/FINDINGS.md](eval/FINDINGS.md).

## Metrics

- **Missed-action rate (primary).** Of the messages that needed action today, the share marked as needing none. Target under 10 percent.
- **False-alarm rate, watched equally closely.** A tool that escalates everything gets ignored within a week, which is the same failure as the portal nobody used.

Overall accuracy is explicitly not the metric.

## Running it locally

Needs Node 22 or later and an Anthropic API key.

```bash
npm install
echo "ANTHROPIC_API_KEY=your-key" > .env.local
npm run dev
```

Open http://localhost:3000/inbox and load the 25-message eval batch.

- `npm run eval:run` triages all 25 messages and prints every result.
- `npm run eval` scores the agent against the hand labels in `eval/cases.json`.
- Set `EVAL_TODAY=YYYY-MM-DD` to pin the date for a reproducible run.

## Architecture

- **Next.js 15 App Router** with three pages: open orders, producers, and the inbox.
- **In-memory store** (`lib/store.ts`), a deliberate prototype choice that resets on restart. Pages only call its typed async functions, so moving to Postgres means rewriting those functions as queries, with no page changes.
- **Urgency flags in code** (`lib/agent.ts`), computed per order before the model sees anything.
- **One model call per message**, forced through a structured tool. A message that cannot be read comes back as act-today.
- **Reconciliation pass.** An order one message blocks and another reports ready becomes a conflict at the top of the queue, with no side chosen.
- **The prompt lives in its own versioned file** (`lib/prompt.ts`), because it is the product logic.

## What this does not do

- No authentication.
- No persistence.
- No real messaging integration.
- English only.
- No production monitoring.
- No retry or rate-limit handling beyond the SDK defaults.
- No cost ceiling per batch.

The message set is synthetic. I cannot use real supplier data, so I wrote a specification per case covering the failure modes I encountered running this operation, and generated the surface text from those specs.

There are no hand-labelled cases yet, so the eval harness has nothing to score and there are no accuracy figures in this README. That is deliberate rather than an omission.

## What I would build next and why

1. **The `awaitingOurResponse` flag.** An unanswered producer question is the only delay cause entirely within our control.
2. **The scored eval harness on hand-labelled cases.** Every claim after it depends on it.
3. **The review queue with an override log.** Once the labelled set runs out, reviewer overrides are the production monitor.

Built by a product manager with an AI coding agent, with no engineering support.
