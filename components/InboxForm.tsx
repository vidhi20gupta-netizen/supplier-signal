"use client";

import { useActionState, useState, useTransition } from "react";
import { loadEvalBatch, runTriage, type InboxState, type TriageResult } from "@/app/inbox/actions";
import { TierBadge } from "@/components/Badges";
import type { Triage } from "@/lib/types";

const PLACEHOLDER = `--- M-01 | PR-02 | WHATSAPP | 07:40
Namaste ji, SS-1042 will go 3 days late...

--- M-02 | Khurja Clay House | SMS | 07:46
Quarry strike, no red clay this week.`;

const TRIAGE_LABEL: Record<Triage, string> = { ACT_TODAY: "Act today", MONITOR: "Monitor", NO_CHANGE: "No change" };

function daysText(d: number) {
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return "today";
  return d === 1 ? "1 day" : `${d} days`;
}

function ResultCard({ r }: { r: TriageResult }) {
  const s = r.signal;
  const failed = s.confidence === 0 && s.reasoning.startsWith("Automatic triage failed");
  return (
    <section className={`card result result-${s.triage}`}>
      <div className="result-head">
        <span className={`badge triage-${s.triage}`}>{TRIAGE_LABEL[s.triage]}</span>
        <span className="badge change">{s.changeType.replace("_", " ")}</span>
        {failed && <span className="badge triage-ACT_TODAY">Could not read</span>}
        <span className="mono small">{r.message.id}</span>
        <span>{r.producerName}</span>
        <TierBadge tier={r.tier} short />
        <span className="muted small">{r.message.channel}</span>
        <span className="muted small result-conf">confidence {s.confidence.toFixed(2)}</span>
      </div>
      <blockquote className="message-body">{r.message.body}</blockquote>
      {r.orders.length > 0 ? (
        <table className="affected">
          <tbody>
            {r.orders.map((o) => (
              <tr key={o.id}>
                <td className="mono">{o.id}</td>
                <td>{o.productName}</td>
                <td className="num">×{o.quantity}</td>
                <td className={o.daysToDispatch <= 1 ? "due-today nowrap" : "nowrap"}>
                  promised {o.promisedDispatchDate} · {daysText(o.daysToDispatch)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted small">No open orders affected.</div>
      )}
      <dl className="facts">
        {s.newDispatchDate && (<><dt>New dispatch</dt><dd>{s.newDispatchDate}</dd></>)}
        {s.quantityAffected != null && (<><dt>Units affected</dt><dd>{s.quantityAffected}</dd></>)}
        {s.materialsBlocked.length > 0 && (<><dt>Materials blocked</dt><dd>{s.materialsBlocked.join(", ")}</dd></>)}
        {s.blockedUntil && (<><dt>Blocked until</dt><dd>{s.blockedUntil}</dd></>)}
      </dl>
      <p className="reasoning">{s.reasoning}</p>
    </section>
  );
}

// runTriage returns its own errors, but the request itself can still fail (a serverless time limit
// on a large batch, a dropped connection). Catch that here so it shows in the form, not as the
// Next.js error page.
async function runTriageSafely(prev: InboxState, formData: FormData): Promise<InboxState> {
  try {
    return await runTriage(prev, formData);
  } catch {
    return {
      status: "error",
      errors: [
        "The triage request did not complete. On a large batch this is usually the server time limit. Try again, or run fewer messages at once.",
      ],
      text: String(formData.get("batch") ?? ""),
    };
  }
}

export function InboxForm() {
  const [state, action, pending] = useActionState<InboxState, FormData>(runTriageSafely, { status: "idle" });
  const [text, setText] = useState("");
  const [loading, startLoading] = useTransition();
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadEval = () =>
    startLoading(async () => {
      setLoadError(null);
      try {
        const loaded = await loadEvalBatch();
        if ("error" in loaded) setLoadError(loaded.error);
        else setText(loaded.text);
      } catch {
        setLoadError("Could not reach the server to load the eval batch. Try again.");
      }
    });

  const results = state.status === "done" ? state.results : [];
  const counts = (t: Triage) => results.filter((r) => r.signal.triage === t).length;

  return (
    <>
      <form action={action} className="card inbox-form">
        <textarea
          name="batch"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setLoadError(null);
          }}
          placeholder={PLACEHOLDER}
          rows={12}
          spellCheck={false}
        />
        <div className="inbox-actions">
          <button type="submit" className="btn-primary" disabled={pending || !text.trim()}>
            {pending ? "Triaging…" : "Run triage"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending || loading}
            onClick={loadEval}
          >
            {loading ? "Loading…" : "Load eval batch (25)"}
          </button>
          {pending && <span className="muted small">One model call per message. A full batch takes about a minute.</span>}
        </div>
        {loadError && <p className="form-errors">{loadError}</p>}
        {state.status === "error" && (
          <ul className="form-errors">
            {state.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </form>

      {state.status === "done" && (
        <>
          <div className="summary">
            {state.conflicts.length > 0 && (
              <span className="badge triage-ACT_TODAY">{state.conflicts.length} conflicts</span>
            )}
            <span className="badge triage-ACT_TODAY">{counts("ACT_TODAY")} act today</span>
            <span className="badge triage-MONITOR">{counts("MONITOR")} monitor</span>
            <span className="badge triage-NO_CHANGE">{counts("NO_CHANGE")} no change</span>
            <span className="muted small">{state.model}</span>
          </div>
          {state.conflicts.length > 0 && (
            <section className="card conflicts" aria-labelledby="conflicts-title">
              <div className="result-head">
                <span className="badge triage-ACT_TODAY">Act today</span>
                <h2 id="conflicts-title">Conflicting reports in this batch</h2>
              </div>
              <p className="muted small">
                These orders are reported as blocked in one message and ready in another. Nothing has been resolved
                automatically.
              </p>
              <ul>
                {state.conflicts.map((c) => (
                  <li key={c.orderId}>
                    <span className="mono">{c.orderId}</span>: {c.statement.slice(c.orderId.length + 2)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="results">
            {results.map((r) => <ResultCard key={r.message.id} r={r} />)}
          </div>
        </>
      )}
    </>
  );
}
