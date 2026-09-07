import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORK_WINDOW_SECONDS,
  parseForkForm,
  resolveNextStep,
  validateBranchGraph,
  validateForkDraft,
  type CandidateEpisode,
  type ChoiceEdge,
  type ForkDraft,
  type GraphEdge,
  type GraphEpisode,
} from "./branching";

// The choice graph's rules, pinned as behaviour: what a set of edges means
// to the player, what the admin form is allowed to save, and what stops a
// show from being published. Every code here is rendered inline by the fork
// panel — a rule that drifts silently would surface as a wrong message to
// the owner, or as a broken fork on the watch page.

function edge(overrides: Partial<ChoiceEdge> = {}): ChoiceEdge {
  return {
    toEpisodeId: "b-1",
    position: 1,
    labelEn: "Kiss",
    labelEs: "Beso",
    isDefault: false,
    ...overrides,
  };
}

describe("resolveNextStep", () => {
  it("≥2 choices is a fork, in position order", () => {
    const step = resolveNextStep({ branchOfEpisodeId: null }, [
      edge({ toEpisodeId: "b-2", position: 2 }),
      edge({ toEpisodeId: "b-1", position: 1 }),
    ]);
    expect(step.kind).toBe("fork");
    if (step.kind !== "fork") throw new Error("expected fork");
    expect(step.choices.map((c) => c.toEpisodeId)).toEqual(["b-1", "b-2"]);
  });

  it("exactly 1 choice is a silent auto-transition — no prompt", () => {
    expect(
      resolveNextStep({ branchOfEpisodeId: "p" }, [edge({ toEpisodeId: "ep-4" })]),
    ).toEqual({ kind: "auto", toEpisodeId: "ep-4" });
  });

  it("a branch with no choices is an ending", () => {
    expect(resolveNextStep({ branchOfEpisodeId: "p" }, [])).toEqual({
      kind: "ending",
    });
  });

  it("a regular episode with no choices keeps the linear behaviour", () => {
    expect(resolveNextStep({ branchOfEpisodeId: null }, [])).toEqual({
      kind: "linear",
    });
  });
});

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

describe("parseForkForm", () => {
  it("reads the rows in DOM order and drops untouched ones", () => {
    const draft = parseForkForm(
      form({
        branchOfEpisodeId: "",
        forkPromptEn: " Kiss or hug? ",
        forkPromptEs: "¿Beso o abrazo?",
        forkWindowSeconds: "12",
        choiceTarget: ["b-1", "", "b-2"],
        choiceLabelEn: ["Kiss", "", "Hug"],
        choiceLabelEs: ["Beso", "", "Abrazo"],
        defaultChoice: "2",
      }),
    );
    expect(draft).toEqual({
      branchOfEpisodeId: null,
      forkPromptEn: "Kiss or hug?",
      forkPromptEs: "¿Beso o abrazo?",
      forkWindowSeconds: 12,
      choices: [
        { toEpisodeId: "b-1", labelEn: "Kiss", labelEs: "Beso" },
        { toEpisodeId: "b-2", labelEn: "Hug", labelEs: "Abrazo" },
      ],
      // The radio named DOM row 2 (0-based); after the blank row is dropped
      // that is position 2 of the kept rows.
      defaultPosition: 2,
    });
  });

  it("keeps a half-filled row so validation can name what is missing", () => {
    const draft = parseForkForm(
      form({ choiceTarget: [""], choiceLabelEn: ["Kiss"], choiceLabelEs: [""] }),
    );
    expect(draft.choices).toEqual([
      { toEpisodeId: "", labelEn: "Kiss", labelEs: "" },
    ]);
  });

  it("defaults the timer and nulls blanks", () => {
    const draft = parseForkForm(form({}));
    expect(draft.forkWindowSeconds).toBe(DEFAULT_FORK_WINDOW_SECONDS);
    expect(draft.branchOfEpisodeId).toBeNull();
    expect(draft.forkPromptEn).toBeNull();
    expect(draft.defaultPosition).toBeNull();
    expect(draft.choices).toEqual([]);
  });
});

const SELF = "ep-3";
const CANDIDATES: CandidateEpisode[] = [
  { id: "ep-2", status: "ready", branchOfEpisodeId: null },
  { id: "ep-4", status: "ready", branchOfEpisodeId: null },
  { id: "b-1", status: "ready", branchOfEpisodeId: SELF },
  { id: "b-2", status: "ready", branchOfEpisodeId: SELF },
  { id: "b-3", status: "ready", branchOfEpisodeId: SELF },
  { id: "b-raw", status: "processing", branchOfEpisodeId: SELF },
  { id: "other-branch", status: "ready", branchOfEpisodeId: "ep-4" },
];

function draft(overrides: Partial<ForkDraft> = {}): ForkDraft {
  return {
    branchOfEpisodeId: null,
    forkPromptEn: "Kiss or hug?",
    forkPromptEs: "¿Beso o abrazo?",
    forkWindowSeconds: 10,
    choices: [
      { toEpisodeId: "b-1", labelEn: "Kiss", labelEs: "Beso" },
      { toEpisodeId: "b-2", labelEn: "Hug", labelEs: "Abrazo" },
    ],
    defaultPosition: 2,
    ...overrides,
  };
}

function code(d: ForkDraft, candidates = CANDIDATES) {
  const r = validateForkDraft(SELF, d, candidates);
  return r.ok ? "ok" : r.code;
}

describe("validateForkDraft — a fork", () => {
  it("accepts two branches of this episode with both locales filled", () => {
    const r = validateForkDraft(SELF, draft(), CANDIDATES);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.values).toEqual({
      branchOfEpisodeId: null,
      forkPromptEn: "Kiss or hug?",
      forkPromptEs: "¿Beso o abrazo?",
      forkWindowSeconds: 10,
      choices: [
        { toEpisodeId: "b-1", position: 1, labelEn: "Kiss", labelEs: "Beso", isDefault: false },
        { toEpisodeId: "b-2", position: 2, labelEn: "Hug", labelEs: "Abrazo", isDefault: true },
      ],
    });
  });

  it("falls back to the first option as default when none (or a stale one) is marked", () => {
    for (const defaultPosition of [null, 0, 7]) {
      const r = validateForkDraft(SELF, draft({ defaultPosition }), CANDIDATES);
      if (!r.ok) throw new Error("expected ok");
      expect(r.values.choices.map((c) => c.isDefault)).toEqual([true, false]);
    }
  });

  it("allows three options and refuses a fourth", () => {
    const three = draft({
      choices: [
        { toEpisodeId: "b-1", labelEn: "A", labelEs: "A" },
        { toEpisodeId: "b-2", labelEn: "B", labelEs: "B" },
        { toEpisodeId: "b-3", labelEn: "C", labelEs: "C" },
      ],
    });
    expect(code(three)).toBe("ok");
    expect(
      code(
        draft({
          choices: [
            ...three.choices,
            { toEpisodeId: "ep-4", labelEn: "D", labelEs: "D" },
          ],
        }),
      ),
    ).toBe("too_many_choices");
  });

  it("keeps the timer within 3–30 whole seconds", () => {
    for (const bad of [2, 31, 99, 10.5, Number.NaN]) {
      expect(code(draft({ forkWindowSeconds: bad }))).toBe(
        "fork_window_out_of_range",
      );
    }
    expect(code(draft({ forkWindowSeconds: 3 }))).toBe("ok");
    expect(code(draft({ forkWindowSeconds: 30 }))).toBe("ok");
  });

  it("refuses an option that is not a branch OF THIS episode", () => {
    // A listed episode as a fork target would be reachable twice — by
    // position and by choice; a branch of another parent is someone else's.
    for (const target of ["ep-4", "other-branch"]) {
      expect(
        code(
          draft({
            choices: [
              { toEpisodeId: "b-1", labelEn: "A", labelEs: "A" },
              { toEpisodeId: target, labelEn: "B", labelEs: "B" },
            ],
          }),
        ),
      ).toBe("choice_target_not_branch");
    }
  });

  it("refuses an option whose video is not ready", () => {
    expect(
      code(
        draft({
          choices: [
            { toEpisodeId: "b-1", labelEn: "A", labelEs: "A" },
            { toEpisodeId: "b-raw", labelEn: "B", labelEs: "B" },
          ],
        }),
      ),
    ).toBe("choice_target_not_ready");
  });

  it("refuses the same target twice, self, and unknown ids", () => {
    const pair = (second: string) =>
      draft({
        choices: [
          { toEpisodeId: "b-1", labelEn: "A", labelEs: "A" },
          { toEpisodeId: second, labelEn: "B", labelEs: "B" },
        ],
      });
    expect(code(pair("b-1"))).toBe("duplicate_choice_target");
    expect(code(pair(SELF))).toBe("choice_target_invalid");
    expect(code(pair("ghost"))).toBe("choice_target_invalid");
    expect(code(pair(""))).toBe("choice_target_required");
  });

  it("needs the prompt and every label in BOTH site locales", () => {
    expect(code(draft({ forkPromptEs: null }))).toBe("fork_prompt_required");
    expect(code(draft({ forkPromptEn: "  " }))).toBe("fork_prompt_required");
    expect(
      code(
        draft({
          choices: [
            { toEpisodeId: "b-1", labelEn: "Kiss", labelEs: "" },
            { toEpisodeId: "b-2", labelEn: "Hug", labelEs: "Abrazo" },
          ],
        }),
      ),
    ).toBe("choice_label_required");
  });
});

describe("validateForkDraft — fewer than two options", () => {
  it("a prompt with one option is an unfinished fork, not a silent hop", () => {
    expect(
      code(draft({ choices: [{ toEpisodeId: "b-1", labelEn: "A", labelEs: "A" }] })),
    ).toBe("fork_needs_two_choices");
    expect(code(draft({ choices: [] }))).toBe("fork_needs_two_choices");
  });

  it("one option without a prompt is a silent transition to ANY ready episode", () => {
    const r = validateForkDraft(
      SELF,
      draft({
        forkPromptEn: null,
        forkPromptEs: null,
        choices: [{ toEpisodeId: "ep-4", labelEn: "", labelEs: "" }],
        defaultPosition: 1,
      }),
      CANDIDATES,
    );
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
    expect(r.values.forkPromptEn).toBeNull();
    expect(r.values.choices).toEqual([
      { toEpisodeId: "ep-4", position: 1, labelEn: "", labelEs: "", isDefault: false },
    ]);
  });

  it("no options and no prompt clears the fork", () => {
    const r = validateForkDraft(
      SELF,
      draft({ forkPromptEn: null, forkPromptEs: null, choices: [] }),
      CANDIDATES,
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.values.choices).toEqual([]);
  });

  it("still refuses a silent hop into a not-ready episode", () => {
    expect(
      code(
        draft({
          forkPromptEn: null,
          forkPromptEs: null,
          choices: [{ toEpisodeId: "b-raw", labelEn: "", labelEs: "" }],
        }),
      ),
    ).toBe("choice_target_not_ready");
  });
});

describe("validateForkDraft — branch parent", () => {
  it("accepts another episode of the show, including a branch (nested forks)", () => {
    expect(code(draft({ branchOfEpisodeId: "ep-2" }))).toBe("ok");
    expect(code(draft({ branchOfEpisodeId: "other-branch" }))).toBe("ok");
  });

  it("refuses self and unknown ids as the parent", () => {
    expect(code(draft({ branchOfEpisodeId: SELF }))).toBe("branch_parent_invalid");
    expect(code(draft({ branchOfEpisodeId: "ghost" }))).toBe("branch_parent_invalid");
  });
});

// ---------- publish guard ----------

function node(
  id: string,
  overrides: Partial<Omit<GraphEpisode, "id">> = {},
): GraphEpisode {
  return {
    id,
    status: "ready",
    branchOfEpisodeId: null,
    hasForkPrompt: false,
    ...overrides,
  };
}

function link(from: string, to: string, position = 1): GraphEdge {
  return { fromEpisodeId: from, toEpisodeId: to, position };
}

// ep-1 → ep-2 (fork) → b-1 | b-2 → ep-3 (reconvergence).
const GRAPH: GraphEpisode[] = [
  node("ep-1"),
  node("ep-2", { hasForkPrompt: true }),
  node("b-1", { branchOfEpisodeId: "ep-2" }),
  node("b-2", { branchOfEpisodeId: "ep-2" }),
  node("ep-3"),
];
const EDGES: GraphEdge[] = [
  link("ep-2", "b-1", 1),
  link("ep-2", "b-2", 2),
  link("b-1", "ep-3"),
  link("b-2", "ep-3"),
];

describe("validateBranchGraph", () => {
  it("passes a fork that reconverges", () => {
    expect(validateBranchGraph(GRAPH, EDGES)).toEqual({ ok: true });
  });

  it("passes a plain linear show (no edges at all)", () => {
    expect(validateBranchGraph([node("ep-1"), node("ep-2")], [])).toEqual({
      ok: true,
    });
  });

  it("passes multiple endings — a branch with no way out", () => {
    const edges = EDGES.filter((e) => e.fromEpisodeId !== "b-2");
    expect(validateBranchGraph(GRAPH, edges)).toEqual({ ok: true });
  });

  it("refuses a prompt with fewer than two options", () => {
    // The admin deleted one option after saving the fork: the remaining
    // single row would play as a silent hop with the question never shown.
    const edges = EDGES.filter((e) => e.toEpisodeId !== "b-2");
    expect(validateBranchGraph(GRAPH, edges)).toEqual({
      ok: false,
      code: "publish_fork_incomplete",
    });
  });

  it("refuses a choice into an episode whose video is not ready", () => {
    // Fork target still processing (a re-upload after the fork was built)…
    const raw = GRAPH.map((n) =>
      n.id === "b-2" ? { ...n, status: "processing" as const } : n,
    );
    expect(validateBranchGraph(raw, EDGES)).toEqual({
      ok: false,
      code: "publish_branch_not_ready",
    });
    // …and a silent reconvergence into one that is not ready either.
    const rawEnd = GRAPH.map((n) =>
      n.id === "ep-3" ? { ...n, status: "errored" as const } : n,
    );
    expect(validateBranchGraph(rawEnd, EDGES)).toEqual({
      ok: false,
      code: "publish_branch_not_ready",
    });
  });

  it("refuses a fork option that is no longer a branch of its parent", () => {
    // branch_of was cleared on b-2 after the fork was saved.
    const cleared = GRAPH.map((n) =>
      n.id === "b-2" ? { ...n, branchOfEpisodeId: null } : n,
    );
    expect(validateBranchGraph(cleared, EDGES)).toEqual({
      ok: false,
      code: "publish_choice_target_not_branch",
    });
  });

  it("refuses a cycle", () => {
    // ep-3 silently hops back to ep-2, whose fork leads back to ep-3.
    expect(validateBranchGraph(GRAPH, [...EDGES, link("ep-3", "ep-2")])).toEqual({
      ok: false,
      code: "publish_branch_cycle",
    });
    // A one-node loop counts too.
    expect(
      validateBranchGraph([node("ep-1")], [link("ep-1", "ep-1")]),
    ).toEqual({ ok: false, code: "publish_branch_cycle" });
  });

  it("ignores what no viewer can reach: not-ready starts and orphan branches", () => {
    const withOrphans: GraphEpisode[] = [
      ...GRAPH,
      // A processing regular episode with a half-built fork on it.
      node("ep-9", { status: "processing", hasForkPrompt: true }),
      // A branch nobody points at, with a not-ready target of its own.
      node("b-orphan", { branchOfEpisodeId: "ep-9" }),
      node("b-raw", { branchOfEpisodeId: "ep-9", status: "processing" }),
    ];
    expect(
      validateBranchGraph(withOrphans, [...EDGES, link("b-orphan", "b-raw")]),
    ).toEqual({ ok: true });
  });
});
