// Scores the triage agent against the hand labels in eval/cases.json.
// Usage: npm run eval   (reads ANTHROPIC_API_KEY from .env.local)
// Writes the full run to eval/results.json.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { MODEL, triageBatch } from "../lib/agent";
import { parseBatch } from "../lib/batch";
import { TODAY } from "../lib/dates";
import { PROMPT_VERSION } from "../lib/prompt";
import { listProducers } from "../lib/store";
import { formatReport, readLabels, score, type RawCase } from "./score";

function git() {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const status = run("git status --porcelain");
  const dirtyFiles = status ? status.split("\n").map((l) => l.slice(3)) : [];
  return { commit: run("git rev-parse HEAD"), dirty: dirtyFiles.length > 0, dirtyFiles };
}

// Uncommitted edits to these files change results without changing the commit hash.
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const FINGERPRINTED = ["lib/prompt.ts", "lib/agent.ts", "lib/seed.ts", "eval/messages.txt", "eval/cases.json"];

async function main() {
  const producers = await listProducers();
  const { messages, errors: parseErrors } = parseBatch(readFileSync("eval/messages.txt", "utf8"), producers);
  const raw = JSON.parse(readFileSync("eval/cases.json", "utf8")) as RawCase[];
  const { cases, errors } = readLabels(raw, messages);
  if (parseErrors.length || errors.length) {
    console.error([...parseErrors, ...errors].join("\n"));
    process.exit(1);
  }
  if (cases.length === 0) {
    console.log(`0 of ${raw.length} cases in eval/cases.json are labelled (every expected field is still "TODO").`);
    console.log("Nothing to score, so no API calls were made and eval/results.json was not written.");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local and run again.");
    process.exit(1);
  }

  const batch = cases.map((c) => messages[c.messageIndex]);
  console.log(`Running ${MODEL} (prompt ${PROMPT_VERSION}) on ${batch.length} of ${raw.length} cases that have labels…\n`);
  const startedAt = new Date();
  const { signals, conflicts } = await triageBatch(batch);
  const finishedAt = new Date();
  const scores = score(cases, signals, messages);

  if (conflicts.length) {
    console.log(`CONFLICTS (${conflicts.length}) · ACT_TODAY · conflicting reports in this batch`);
    for (const c of conflicts) console.log(`  ${c.statement}`);
    console.log("");
  }
  console.log(formatReport(scores));

  const results = {
    timestamp: startedAt.toISOString(),
    durationSeconds: (finishedAt.getTime() - startedAt.getTime()) / 1000,
    git: git(),
    fileSha256: Object.fromEntries(FINGERPRINTED.map((f) => [f, sha256(f)])),
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    // Seed dates are relative to the run date, so the same commit scores against different calendar dates.
    today: TODAY,
    casesTotal: raw.length,
    casesLabelled: cases.length,
    scores,
    conflicts,
    runs: cases.map((c, i) => ({ case: c, message: batch[i], signal: signals[i] })),
  };
  writeFileSync("eval/results.json", JSON.stringify(results, null, 2) + "\n");
  console.log(`\nFull run written to eval/results.json (commit ${results.git.commit?.slice(0, 7) ?? "unknown"}${results.git.dirty ? ", uncommitted changes" : ""}).`);
}

main();
