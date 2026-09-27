import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The babysitter's snapshot is a jq program (FILTER) inside a bash script:
// `gh pr view --json …statusCheckRollup… --jq "$FILTER"`, compared as a string
// against the previous snapshot every minute — any difference wakes the agent.
// The test lifts FILTER straight out of the script (no copy to drift) and runs
// it through the system jq on rollups shaped like gh's real output: a CheckRun
// carries name/status/conclusion, a StatusContext (how Vercel reports, incl.
// the required «Vercel – matio») carries context/state instead. gh itself
// evaluates --jq with its embedded gojq; the filter uses only constructs both
// implement identically (`//`, ascii_upcase, sort, string interpolation).

const ROOT = path.join(import.meta.dirname, "../..");
const LIVE = "tools/claude/pr_babysit.sh";
// The mega-process kit's copy of the same script (docs/mega-process/tools/,
// «полные рабочие копии боевых скриптов»): the fix must travel with it.
const KIT_COPY = "docs/mega-process/tools/pr_babysit.sh";

function filterOf(file: string): string {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  // FILTER is one single-quoted bash string; a `'` inside it would end the
  // string early — and fail this match, loudly.
  const match = source.match(/^FILTER='([^']*)'$/m);
  if (!match) throw new Error(`FILTER='…' not found in ${file}`);
  return match[1];
}

const FILTER = filterOf(LIVE);

type Snapshot = {
  state: string;
  red: string[];
  comments: number;
  reviews: number;
  decision: string | null;
  conflicting: boolean;
  behind: boolean;
};

/** Runs FILTER over a `gh pr view --json …` payload; returns jq's raw line. */
function rawSnapshot(rollup: unknown[] | null): string {
  const payload = {
    state: "OPEN",
    statusCheckRollup: rollup,
    comments: [{ body: "…" }, { body: "…" }],
    latestReviews: [{ state: "COMMENTED" }],
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    mergeStateStatus: "BEHIND",
  };
  return execFileSync("jq", ["-c", FILTER], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  }).trim();
}

const snapshot = (rollup: unknown[] | null): Snapshot =>
  JSON.parse(rawSnapshot(rollup)) as Snapshot;
const red = (rollup: unknown[] | null) => snapshot(rollup).red;

const CI = "web (lint · types · tests)";
const checkRun = (status: string, conclusion: string | null) => ({
  __typename: "CheckRun",
  name: CI,
  status,
  conclusion,
  workflowName: "ci",
});
const vercel = (state: string) => ({
  __typename: "StatusContext",
  context: "Vercel – matio",
  state,
});

describe("pr_babysit.sh FILTER — which checks are red (#353)", () => {
  it("a running check is NOT red: gh reports its conclusion as an empty string", () => {
    // The bug: `select(.conclusion != null)` let "" through, and "" is not
    // SUCCESS — so every push woke the agent with `red: ["web …:"]`.
    expect(red([checkRun("IN_PROGRESS", "")])).toEqual([]);
  });

  it("a queued check with a null conclusion is NOT red", () => {
    expect(red([checkRun("QUEUED", null)])).toEqual([]);
  });

  it("a failed check IS red, reported as name:CONCLUSION", () => {
    expect(red([checkRun("COMPLETED", "FAILURE")])).toEqual([`${CI}:FAILURE`]);
  });

  it("SUCCESS, NEUTRAL and SKIPPED are green — nothing red", () => {
    expect(
      red([
        checkRun("COMPLETED", "SUCCESS"),
        { ...checkRun("COMPLETED", "NEUTRAL"), name: "neutral-check" },
        { ...checkRun("COMPLETED", "SKIPPED"), name: "skipped-check" },
      ]),
    ).toEqual([]);
  });

  it("every other finished conclusion stays red, whatever its case", () => {
    expect(
      red([
        { ...checkRun("COMPLETED", "CANCELLED"), name: "b" },
        { ...checkRun("COMPLETED", "TIMED_OUT"), name: "a" },
        { ...checkRun("COMPLETED", "failure"), name: "c" },
        { ...checkRun("COMPLETED", "success"), name: "d" },
      ]),
    ).toEqual(["a:TIMED_OUT", "b:CANCELLED", "c:failure"]);
  });

  it("a Vercel status that failed IS red; a pending or green one is not", () => {
    expect(red([vercel("PENDING")])).toEqual([]);
    expect(red([vercel("EXPECTED")])).toEqual([]);
    expect(red([vercel("SUCCESS")])).toEqual([]);
    expect(red([vercel("FAILURE")])).toEqual(["Vercel – matio:FAILURE"]);
    expect(red([vercel("ERROR")])).toEqual(["Vercel – matio:ERROR"]);
  });

  it("a push's whole CI lifecycle up to green is ONE snapshot — no wake-up", () => {
    // The script compares snapshots as strings; queued → running → green must
    // print the same line every time, or the agent is woken for nothing.
    const stages = [
      [checkRun("QUEUED", null), vercel("PENDING")],
      [checkRun("IN_PROGRESS", ""), vercel("PENDING")],
      [checkRun("IN_PROGRESS", ""), vercel("SUCCESS")],
      [checkRun("COMPLETED", "SUCCESS"), vercel("SUCCESS")],
    ].map(rawSnapshot);
    expect(new Set(stages).size).toBe(1);
  });

  it("no checks at all (an empty or missing rollup) is not red", () => {
    expect(red([])).toEqual([]);
    expect(red(null)).toEqual([]);
  });

  it("keeps the snapshot's shape — the main session parses these lines", () => {
    expect(snapshot([checkRun("COMPLETED", "FAILURE")])).toEqual({
      state: "OPEN",
      red: [`${CI}:FAILURE`],
      comments: 2,
      reviews: 1,
      decision: "REVIEW_REQUIRED",
      conflicting: false,
      behind: true,
    });
  });

  it("the mega-process kit's copy carries the same FILTER", () => {
    expect(filterOf(KIT_COPY)).toBe(FILTER);
  });
});
