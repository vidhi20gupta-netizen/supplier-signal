// Pure scoring for the triage eval: no I/O, no API calls, so it can be tested on its own.
import type { ChangeType, Message, Signal, Triage } from "../lib/types";

export const CHANGE_TYPES: ChangeType[] = ["LATE", "PARTIAL", "CANCELLED", "CAPACITY_CONSTRAINT", "QUALITY", "NONE"];
export const TRIAGES: Triage[] = ["ACT_TODAY", "MONITOR", "NO_CHANGE"];

/** One row of eval/cases.json. Any expected field may still be "TODO". */
export type RawCase = {
  id: string;
  messageIndex: number;
  expectedChangeType: ChangeType | "TODO";
  expectedAffectedOrderIds: string[] | "TODO";
  expectedTriage: Triage | "TODO";
  note: string;
};

export type LabelledCase = {
  id: string;
  messageIndex: number;
  expectedChangeType: ChangeType | null;
  expectedAffectedOrderIds: string[] | null;
  expectedTriage: Triage | null;
  note: string;
};

/** Checks labels and returns cases with at least one label. "TODO" fields become null. */
export function readLabels(raw: RawCase[], messages: Message[]): { cases: LabelledCase[]; errors: string[] } {
  const errors: string[] = [];
  const cases: LabelledCase[] = [];
  for (const c of raw) {
    const where = `cases.json ${c.id}`;
    const message = messages[c.messageIndex];
    if (!message) errors.push(`${where}: messageIndex ${c.messageIndex} is not in eval/messages.txt`);
    else if (message.id !== c.id) errors.push(`${where}: messageIndex ${c.messageIndex} is message ${message.id}`);

    const triage = c.expectedTriage === "TODO" ? null : c.expectedTriage;
    if (triage !== null && !TRIAGES.includes(triage)) errors.push(`${where}: expectedTriage "${triage}" is not one of ${TRIAGES.join(", ")}`);

    const change = c.expectedChangeType === "TODO" ? null : c.expectedChangeType;
    if (change !== null && !CHANGE_TYPES.includes(change)) {
      errors.push(`${where}: expectedChangeType "${change}" is not one of ${CHANGE_TYPES.join(", ")}`);
    }

    const ids = c.expectedAffectedOrderIds === "TODO" ? null : c.expectedAffectedOrderIds;
    if (ids !== null && !(Array.isArray(ids) && ids.every((x) => typeof x === "string"))) {
      errors.push(`${where}: expectedAffectedOrderIds must be an array of order ids or "TODO"`);
    }

    if (triage === null && change === null && ids === null) continue;
    cases.push({ id: c.id, messageIndex: c.messageIndex, expectedTriage: triage, expectedChangeType: change, expectedAffectedOrderIds: ids, note: c.note });
  }
  return { cases, errors };
}

export type Rate = { numerator: number; denominator: number; rate: number | null; caseIds: string[] };

const rate = (caseIds: string[], denominator: number): Rate => ({
  numerator: caseIds.length,
  denominator,
  rate: denominator ? caseIds.length / denominator : null,
  caseIds,
});

export type Miss = {
  id: string;
  message: Message;
  note: string;
  problems: string[];
  expected: { triage: Triage | null; changeType: ChangeType | null; affectedOrderIds: string[] | null };
  actual: { triage: Triage; changeType: ChangeType; affectedOrderIds: string[]; confidence: number };
  reasoning: string;
};

export type Scores = {
  labelled: number;
  missedAction: Rate;
  falseAlarm: Rate;
  crossReferenceRecall: { found: number; expected: number; recall: number | null; cases: { id: string; missing: string[] }[] };
  overReach: { total: number; casesScored: number; cases: { id: string; extra: string[] }[] };
  changeType: { correct: number; scored: number; accuracy: number | null; matrix: Record<ChangeType, Record<ChangeType, number>> };
  misses: Miss[];
};

/** Scores signals against labels. `signals[i]` must be the agent's output for `cases[i]`. */
export function score(cases: LabelledCase[], signals: Signal[], messages: Message[]): Scores {
  const missedIds: string[] = [];
  let actDenominator = 0;
  const falseAlarmIds: string[] = [];
  let noChangeDenominator = 0;
  let found = 0;
  let expectedMulti = 0;
  const recallCases: Scores["crossReferenceRecall"]["cases"] = [];
  const overReachCases: Scores["overReach"]["cases"] = [];
  let idsScored = 0;
  const matrix = Object.fromEntries(
    CHANGE_TYPES.map((e) => [e, Object.fromEntries(CHANGE_TYPES.map((a) => [a, 0]))]),
  ) as Record<ChangeType, Record<ChangeType, number>>;
  let changeScored = 0;
  let changeCorrect = 0;
  const misses: Miss[] = [];

  cases.forEach((c, i) => {
    const s = signals[i];
    const problems: string[] = [];

    if (c.expectedTriage === "ACT_TODAY") {
      actDenominator++;
      if (s.triage !== "ACT_TODAY") missedIds.push(c.id);
    }
    if (c.expectedTriage === "NO_CHANGE") {
      noChangeDenominator++;
      if (s.triage !== "NO_CHANGE") falseAlarmIds.push(c.id);
    }
    if (c.expectedTriage !== null && c.expectedTriage !== s.triage) {
      problems.push(`triage: expected ${c.expectedTriage}, got ${s.triage}`);
    }

    if (c.expectedAffectedOrderIds !== null) {
      idsScored++;
      const expected = new Set(c.expectedAffectedOrderIds);
      const actual = new Set(s.affectedOrderIds);
      const missing = [...expected].filter((id) => !actual.has(id));
      const extra = [...actual].filter((id) => !expected.has(id));
      if (expected.size > 1) {
        expectedMulti += expected.size;
        found += expected.size - missing.length;
        recallCases.push({ id: c.id, missing });
      }
      if (extra.length) overReachCases.push({ id: c.id, extra });
      if (missing.length) problems.push(`missed orders: ${missing.join(", ")}`);
      if (extra.length) problems.push(`unexpected orders: ${extra.join(", ")}`);
    }

    if (c.expectedChangeType !== null) {
      changeScored++;
      matrix[c.expectedChangeType][s.changeType]++;
      if (c.expectedChangeType === s.changeType) changeCorrect++;
      else problems.push(`changeType: expected ${c.expectedChangeType}, got ${s.changeType}`);
    }

    if (problems.length) {
      misses.push({
        id: c.id,
        message: messages[c.messageIndex],
        note: c.note,
        problems,
        expected: { triage: c.expectedTriage, changeType: c.expectedChangeType, affectedOrderIds: c.expectedAffectedOrderIds },
        actual: { triage: s.triage, changeType: s.changeType, affectedOrderIds: s.affectedOrderIds, confidence: s.confidence },
        reasoning: s.reasoning,
      });
    }
  });

  return {
    labelled: cases.length,
    missedAction: rate(missedIds, actDenominator),
    falseAlarm: rate(falseAlarmIds, noChangeDenominator),
    crossReferenceRecall: { found, expected: expectedMulti, recall: expectedMulti ? found / expectedMulti : null, cases: recallCases },
    overReach: { total: overReachCases.reduce((n, c) => n + c.extra.length, 0), casesScored: idsScored, cases: overReachCases },
    changeType: { correct: changeCorrect, scored: changeScored, accuracy: changeScored ? changeCorrect / changeScored : null, matrix },
    misses,
  };
}

// ---------- Text report ----------

const pct = (r: number | null) => (r === null ? "n/a" : `${(r * 100).toFixed(1)}%`);
const SHORT: Record<ChangeType, string> = {
  LATE: "LATE",
  PARTIAL: "PART",
  CANCELLED: "CANC",
  CAPACITY_CONSTRAINT: "CAP",
  QUALITY: "QUAL",
  NONE: "NONE",
};

export function formatReport(s: Scores): string {
  const out: string[] = [];
  const line = (label: string, value: string, detail = "") =>
    out.push(`${label.padEnd(34)}${value.padStart(8)}   ${detail}`);

  out.push(`SUMMARY (${s.labelled} labelled cases)`);
  out.push("─".repeat(96));
  const ma = s.missedAction;
  line(
    "1. MISSED-ACTION RATE  [PRIMARY]",
    pct(ma.rate),
    `${ma.numerator}/${ma.denominator} labelled ACT_TODAY marked MONITOR or NO_CHANGE · target < 10%${
      ma.rate === null ? "" : ma.rate < 0.1 ? " · MET" : " · NOT MET"
    }`,
  );
  const fa = s.falseAlarm;
  line(
    "2. FALSE-ALARM RATE",
    pct(fa.rate),
    `${fa.numerator}/${fa.denominator} labelled NO_CHANGE escalated · decides whether the tool gets used at all`,
  );
  const cr = s.crossReferenceRecall;
  line(
    "3. CROSS-REFERENCE RECALL",
    pct(cr.recall),
    `${cr.found}/${cr.expected} expected order ids found, over ${cr.cases.length} cases with >1 expected order · the capability claim`,
  );
  line(
    "4. OVER-REACH",
    String(s.overReach.total),
    `unexpected order ids named, in ${s.overReach.cases.length} of ${s.overReach.casesScored} cases with labelled orders`,
  );
  const ct = s.changeType;
  line("5. CHANGE-TYPE ACCURACY", pct(ct.accuracy), `${ct.correct}/${ct.scored}`);
  out.push("─".repeat(96));

  if (ma.caseIds.length) out.push(`Missed actions: ${ma.caseIds.join(", ")}`);
  if (fa.caseIds.length) out.push(`False alarms: ${fa.caseIds.join(", ")}`);
  for (const c of cr.cases.filter((c) => c.missing.length)) out.push(`Cross-reference ${c.id} missed: ${c.missing.join(", ")}`);
  for (const c of s.overReach.cases) out.push(`Over-reach ${c.id}: ${c.extra.join(", ")}`);

  if (ct.scored) {
    out.push("", "Change-type confusion matrix (rows expected, columns actual)");
    out.push("".padEnd(10) + CHANGE_TYPES.map((t) => SHORT[t].padStart(6)).join(""));
    for (const e of CHANGE_TYPES) {
      const row = CHANGE_TYPES.map((a) => ct.matrix[e][a]);
      if (row.every((n) => n === 0)) continue;
      out.push(SHORT[e].padEnd(10) + row.map((n, i) => (n ? (CHANGE_TYPES[i] === e ? `[${n}]` : String(n)) : "·").padStart(6)).join(""));
    }
  }

  out.push("", `6. INDIVIDUAL MISSES (${s.misses.length})`);
  if (s.misses.length === 0) out.push("None.");
  for (const m of s.misses) {
    out.push("", `━━ ${m.id} · ${m.note}`);
    out.push(`   message:   "${m.message.body.replace(/\s+/g, " ")}"`);
    for (const p of m.problems) out.push(`   ✗ ${p}`);
    const ids = (x: string[] | null) => (x === null ? "(unlabelled)" : x.length ? x.join(", ") : "none");
    out.push(`   expected:  ${m.expected.triage ?? "(unlabelled)"} · ${m.expected.changeType ?? "(unlabelled)"} · ${ids(m.expected.affectedOrderIds)}`);
    out.push(`   actual:    ${m.actual.triage} · ${m.actual.changeType} · ${ids(m.actual.affectedOrderIds)} · confidence ${m.actual.confidence}`);
    out.push(`   reasoning: ${m.reasoning}`);
  }
  return out.join("\n");
}
