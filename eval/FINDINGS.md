# Findings

Run 1 was 25 supplier messages across 5 producers, batch date 3 November 2026.

There is no scored evaluation harness yet, so instead of a number this is the
result of reading every output against the open order book by hand. That
surfaced nine defects. Two of them need no ground truth at all, because they
are internal contradictions in the run and can be checked directly against the
output.

The five below are the ones that changed, or are changing, the build. The
remaining four are listed at the end with their current status.

---

## 1. The same order received two different urgency levels in one run

Order `SS-1043`, promised 5 November, appears in two messages.

| Message | Triage | Stated reason |
| --- | --- | --- |
| M-02 | MONITOR | the promised dispatch is "beyond 48H from today" |
| M-13 | ACT_TODAY | the order is "within 48 hours" |

Same order, same promise date, same batch date, opposite triage, and the two
stated reasons contradict each other directly. One of them is wrong and no
judgement call is needed to establish that.

**Cause.** The model was not resolving an ambiguity; it was ignoring an
instruction, intermittently. Run 1 did not leave the boundary to the model: the
code labelled each order "WITHIN 48H" when it was due today or tomorrow and
"later" otherwise, and the prompt said to use that label and not recompute it.
`SS-1043`, two days out, was labelled "later". M-02 followed the label. M-13
overrode it with its own date arithmetic, and so did M-03 for `SS-1045` at the
same distance. Five messages in this batch turn mainly on an order exactly two
days out, and eight touch one, so this is not an edge case: it is a fifth to a
third of the batch.

**Fix.** Urgency is now computed in code as named flags, `daysRemaining`,
`withinActionWindow` and `feasible`, and the triage rule is written as an
ordered checklist over those flags, with an explicit instruction never to
recompute or second-guess them. The window was also widened to two days or
fewer, which puts `SS-1043` inside it. In the re-run, both messages triaged
`SS-1043` the same way and each cited `withinActionWindow=true`.

That is one run. Run 1 also handed the model a value computed in code, and it
overrode that value in two of the five messages where it mattered, so
consistency has to hold across repeated runs before this counts as fixed. A
model that can get date comparisons right most of the time is still the wrong
tool for a comparison that has to be right every time.

---

## 2. A single batch produced mutually contradictory conclusions about three orders

| Order | One message says | Another message says |
| --- | --- | --- |
| `SS-1056` | M-07: blocked by the copper shortage, act today | M-20: "SS-1056 is ready for pickup" |
| `SS-1041` | M-11: held by the workshop floor blockage | M-12: "1041 packed and ready" |
| `SS-1047` | M-08 and M-10: blocked by the clay strike and the full kiln | M-14: "glazed and ready, please send pickup" |

The extraction was correct every time. Each message was read accurately on its
own terms.

**Cause.** Messages are processed independently, with no reconciliation across
the batch. The product is a batch product, so the output taken as a whole was
internally inconsistent: a reviewer opening the queue saw the same order flagged
as blocked and reported as finished, with nothing to indicate which was current.

This was the most serious finding in the run, because it is not an extraction
error that better prompting fixes. It is a structural gap, and it is the kind of
thing that destroys trust in a queue after a reviewer hits it twice.

**Fix.** A reconciliation pass now runs after extraction and before triage is
finalised. It groups signals by order, detects conflicts, and surfaces them at
the top of the queue rather than resolving them:

> `SS-1056`: M-07 reports brass blocked, M-20 reports ready for pickup.
> Confirm which is current.

The decision not to pick a winner was deliberate. The system genuinely does not
know which report is true, and a confident wrong answer here is worse than an
explicit question. The re-run surfaced all three conflicts above, and a fourth
on `SS-1050`, covered next.

One dependency to keep in view: the pass can only see a conflict if the
extraction records the "ready" side, which it now does per order. If it misses
a "packed" or "ready", that conflict disappears silently, and nothing in the
eval tests for it yet.

**One consequence of this fix, found immediately after shipping it.** The
reconciliation pass also flagged `SS-1050`. M-13 reports it finished. Against
that are two messages: M-16 reports it finished but waiting on packing help, and
M-09, the district-wide indigo shortage, lists it among the cotton orders the
shortage blocks. M-22 mentions `SS-1050` but makes no readiness claim and is not
part of the conflict.

These are two different problems. M-16 against M-13 is not a contradiction:
"finished" and "finished but not yet packed" are the same state at two levels of
detail. M-16 only lands on the "cannot ship" side because an undated dependency
is now recorded as LATE (finding 4), so the rule is over-triggering there. M-09
against M-13 is a genuine contradiction in the output, but the error is
upstream: the cross-reference rule lists every open order whose product uses the
blocked material, including one the same producer has reported finished, which a
dye shortage cannot touch. Here the conflict pass did its job by exposing an
over-reach.

Leaving it in for now rather than tightening it, for two reasons. The looser
rule catches a real signal (M-16 changes the dispatch outlook compared with a
flat "finished"), and over-flagging a conflict costs one confirmation while
missing one costs a wrong decision. The proper fix has two parts. First, two
tiers rather than a narrower rule: a hard conflict where one signal says the
order cannot ship and another says it is ready, and a soft conflict where
compatible signals disagree on detail. Only the hard tier should sit above the
act-today list, which would move M-16 out of it. Second, that alone would not
clear `SS-1050`, because M-09 against M-13 is a hard conflict as defined. That
needs the reconciliation pass to know that a material shortage cannot block
goods a producer has already reported finished.

---

## 3. A cancellation was scheduled for tomorrow

M-25, order `SS-1046`: the producer says their eyesight is no longer good
enough for the fine brass jali work and the order should go to someone else. The
tool classified it CANCELLED correctly, then triaged it MONITOR because the
customer promise date was four days out.

**Cause.** The triage rule read only the customer promise date. But for a
cancellation the relevant clock is the replacement producer's lead time, and on
a two to five day fulfilment window that time was already gone. By the time this
item reached the top of the next morning's queue, the replacement would already
have been late.

**Fix.** A cancellation is now always act-today, whatever the customer date
says. That rule is what fixes this case. The `feasible` flag does not: it counts
make time from the date the order was placed, has no notion of a replacement
producer's lead time, and is true for every order in the current seed. Making
triage account for recovery time in general is still open.

---

## 4. An unbounded dependency was recorded as no change at all

M-16: *"1050 will ship soon, as soon as my daughter helps me pack them up after
her exams."* The tool returned change type NONE and triage NO_CHANGE.

NONE means nothing about fulfilment changed. Something did change: dispatch is
now gated on an event with no date attached. The goods being finished is real
and the four-day buffer is real, so this is probably not urgent. But NONE files
it as noise, which means it never reaches a reviewer and nobody ever asks when
the exams end.

**Cause.** The prompt treated "is the order at risk" and "did something change"
as the same question. They are not.

**Fix.** A dispatch dependency with no date is now explicitly a change rather
than an absence of one, even when the order is complete. It is recorded as LATE
with no new date and monitored instead of discarded, which is what the re-run
did with M-16.

This was the most instructive miss in the run, because the message is warm,
cooperative and reads like good news. That is the shape the expensive miss
actually takes, and it is nothing like the shape people expect it to take.

---

## 5. The system has no way to represent "the producer is waiting on us"

Two messages are questions rather than reports:

- M-17: *"Should I ship it anyway or make a new one?"* Order due in two days.
  Triaged MONITOR.
- M-18: *"How do you want us to proceed?"* Order due in one day.
  Triaged ACT_TODAY.

Same structure, and the only thing separating the two outcomes was the promise
date. But in both cases **production has stopped pending our answer**, which is
a materially different and worse state than an order simply being at risk: the
delay is now ours rather than the producer's, and it grows for every hour nobody
replies.

**Cause.** This is a gap in the model of the world, not a bug in the prompt. The
signal schema has no field for it, so the condition cannot be expressed at all.

**Fix.** Not yet implemented. An `awaitingOurResponse` flag on the signal type,
treated as an independent act-today trigger regardless of date, is the next
thing being built. It is first in the queue because an unanswered producer
question is the only delay cause entirely inside our own control.

Since the action window widened to two days, M-17 is now act-today as well, so
this batch no longer shows the gap. It is still there: the same question on an
order three or more days out would still be filed MONITOR.

---

## The other four

**Non-risk content is discarded rather than routed. Open.** The tool only emits
risks, so anything actionable that is not a risk disappears. M-24 is a payment
query with no order attached, correctly triaged no-change and then filed
nowhere. M-13 carries an unresolved payment dispute about goods a courier broke
on a past order, judged out of scope and dropped entirely. M-14 and M-20 both
contain explicit pickup requests on finished orders (`SS-1047`, `SS-1056`), and
neither pickup was recorded as anything to act on. That is four of the 25
messages with actionable content thrown away, and producers who learn that half
their message gets no response stop sending the other half. Since run 1 the
extraction records "ready" reports per order, but only to detect conflicts;
nothing routes them. The fix is a second, independent classification per message
(ready-for-pickup, admin or finance, awaiting-our-response, informational) that
routes rather than discards.

**An identified ambiguity was not escalated. Fixed since run 1.** M-15 refers to
"the cane tray order" and two open orders match it. The tool said so explicitly
in its reasoning and then triaged MONITOR. Nobody can act on an ambiguous signal
without first asking the producer which order they mean, and on this window that
question cannot wait a day. A list of candidate orders is now an act-today
trigger in its own right, and M-15 has come back ACT_TODAY with both tray orders
listed in both runs since.

**An order the tool proved was infeasible was filed for tomorrow. Open, and the
current design will not catch it.** M-12 reports `SS-1055` as not started,
promised in four days, against a five-day make time. The reasoning worked this
out correctly and the triage was MONITOR. The `feasible` flag does not catch it:
the flags are computed before the model reads the message and count production
from the order date, so `SS-1055` shows `feasible=true` and M-12 is still
MONITOR in the re-run. Catching it needs the progress the producer reports ("not
started", "half done") to feed back into feasibility after extraction.

**The reasoning field exposes the model's scratch work. Open.** The reasoning
text is shown to the reviewer, and in three places it contains visible
self-correction: a parenthetical "(no, this is PR-02)" in M-09, an argument with
itself about the 48-hour boundary in M-12, and a count of three followed by a
list of four in M-21. Minor beside the first two findings, and the first thing a
reader notices. The fix is two fields: a short rationale for the reviewer, and a
separate trace kept out of the interface.

---

## What the fixes cost so far

Escalation went up. Run 1 marked 13 of the 25 messages act-today; the current
build marks 19. The two-day window alone covers 12 of the 20 open orders, so
almost any message that names a specific order now escalates. Some of that is
correct, and some of it will be false alarms. Which is which cannot be known
until the labels exist, and it is the number to watch first when they do.

---

## One thing the tool got right that is worth recording

M-09 reports that organic indigo is unavailable across the district. Which of
the open cotton orders actually use indigo is not recorded anywhere in the data,
so there is no correct answer to extract. The tool said exactly that, flagged
all three cotton orders as potentially exposed, asked for clarification instead
of guessing, and returned its lowest confidence of the run at 0.65 against a
0.95 baseline.

That is the behaviour this product needs on an unanswerable question, and it was
not prompted for specifically. Worth noting carefully though: the two lowest
scores of the run were the two genuinely unanswerable references, M-09 at 0.65
and M-15 at 0.75, but 0.85 also appeared on five other messages, so seven of the
25 scored below 0.95. That is suggestive rather than calibrated. It is worth
testing as a routing threshold once there are hand-labelled cases to test it
against, and it is not a quality measure until then.

---

## About the test set itself

Two limitations worth stating before anyone infers more from this than it
supports.

**The messages are synthetic.** Real supplier data cannot be used here, so the
approach was to write a specification per case covering the failure modes
actually encountered running this operation, and generate the surface text from
those specs. Each case was also re-pointed at the seeded order book, so its
original order number and product were replaced (#412 brass diyas became
`SS-1042` brass candle holders, for example). The taxonomy of failures is real.
The wording, order numbers and products are not.

**The batch is a crisis day, not a Tuesday.** The tool marked 13 of the 25
messages act-today in run 1. That is the tool's count, not a labelled one, but
even allowing for its errors a real overnight batch is mostly nothing. Two
consequences: the tool looks more useful here than it would on an average
morning, and no false-alarm rate has been measured yet. The labels are not
filled in, and run 1 marked only five messages no-change, so even once labelled
this set gives very few cases to the metric that decides whether anyone keeps
using the tool at all. The next set adds ten to twelve ordinary no-change
messages, a constraint with a clean end date that should leave the later orders
alone, a material shortage affecting zero open orders as an over-reach test, and
a date written in an awkward format.

The scored harness runs against that set, labelled by hand before the tool sees
it.

---

## Before the next run

The model the agent calls, `claude-sonnet-4-5`, reaches end of life on
30 November 2026, and the API now returns a deprecation warning on every call.
Current models reject the forced tool call the agent relies on for structured
output, so moving off it changes how that output is enforced as well as which
model runs, and the run needs repeating on the new model before any of the
numbers above carry over.
