OMS

# Supplier Signal

## The business
A marketplace between independent artisan producers and consumers. The marketplace onboards the artisanal producers, that can be independent or a separate business of crafting Home decor items altogether.
Order to dispatch runs 2 to 5 days, delivery 3 to 7. 
Producers coordinate over WhatsApp and SMS, not through any portal, because a portal was built once and they would not use it.

## The one decision this tool makes
Reading this morning's batch of supplier messages, decide per open order:
AT_RISK_ACT_TODAY, AT_RISK_MONITOR, or NO_CHANGE. And for the messages that
reference no order at all, decide which open orders they silently affect.

## Why this decision is expensive to get wrong
The fulfilment window is days, not weeks. A signal missed in the morning
batch cannot be recovered in the afternoon. A missed capacity constraint
means we keep accepting orders the producer cannot make, which is how
cancellation got to 25 percent the last time I watched this fail.

## Why a model and not a rule
Producers quote order numbers, so matching messages to orders is mostly
string matching and I am not claiming otherwise. Two things are not:
reading the implied state change out of how people actually write, and
cross-referencing a raw-material or space constraint against every open
order it invalidates when the message names none of them.

## The primary metric
Missed-action rate: of messages that required action today, the share
marked no-action. Target under 10 percent.
Watched equally closely: false-alarm rate. A triage tool that escalates
everything gets ignored within a week, which is the same failure as the
portal nobody used.
Overall accuracy is explicitly not the metric.

## In scope tonight
- Paste a batch of raw messages, get a triaged list of affected orders
- Extract the state change: late, partial, cancelled, capacity constraint
- Cross-reference capacity constraints against open orders
- Recompute each producer's effective capacity and flag overcommitment
- A review queue where a human confirms, overrides, or dismisses
- An eval set of hand-labelled batches and a script that scores it

## Explicitly out of scope
No auth, no database, no real WhatsApp integration, no sending anything to
anyone, no customer-facing surface. English only, which is a simplification
I am naming rather than hiding. In-memory store, resets on restart.

## Supplier tiers, and what they are for
Three tiers set by on-time rate, defect rate, and capacity variance, where
capacity variance is the gap between what a producer says they can do and
what they actually deliver. The tiers are not a ranking of who is good.
They decide how much of a producer's self-report the system acts on without
a human checking it.
- A Trusted: on-time 95%+, defects under 2%, variance under 10%.
  Self-reports applied automatically.
- B Monitored: 85-95%, 2-6%, 10-25%. Applied but flagged for review.
- C Verify: below that. Never auto-applied, capped volume, no same-day
  promises.

## Known unknowns
- The eval labels are my judgement, not outcome data. I have no record of
  which missed signals actually became cancellations.
- Real message volume may be mixed-language. This prototype assumes English.
- Producer capacity was driven by workshop space and raw material
  availability, and neither was ever recorded in a system.  