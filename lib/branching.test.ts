import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORK_WINDOW_SECONDS,
  displayNumber,
  listedAncestor,
  listedEpisodes,
  listedPosition,
  parseForkForm,
  resolveCandidates,
  resolveNextStep,
  validateBranchGraph,
  validateForkDraft,
  type CandidateEpisode,
  type ChoiceEdge,
  type ForkDraft,
  type GraphEdge,
  type GraphEpisode,
  type PlayerChoice,
  type PlayerEpisodeLike,
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

// ---------- player half (#144) ----------
//
// The show on the page: three listed episodes, a fork on ep-2 into two
// branches (902 default, 901 not) that both reconverge silently into ep-3,
// and a branch of ep-3 that is an ending. Branches sit AFTER the linear run
// in the array (900+ numbering sorts them there), which is exactly the
// order the watch page delivers — so `episodes[idx + 1]` of ep-3 would be a
// branch, and the linear rule must skip it.
function pc(overrides: Partial<PlayerChoice> = {}): PlayerChoice {
  return {
    toEpisodeId: "b-901",
    position: 1,
    label: "Kiss",
    isDefault: false,
    ...overrides,
  };
}

function ep(
  id: string,
  number: number,
  overrides: Partial<PlayerEpisodeLike> = {},
): PlayerEpisodeLike {
  return { id, number, branchOfEpisodeId: null, choices: null, ...overrides };
}

const PAGE: PlayerEpisodeLike[] = [
  ep("ep-1", 1),
  ep("ep-2", 2, {
    choices: [
      pc({ toEpisodeId: "b-901", position: 1, label: "Kiss" }),
      pc({ toEpisodeId: "b-902", position: 2, label: "Hug", isDefault: true }),
    ],
  }),
  ep("ep-3", 3),
  ep("b-901", 901, {
    branchOfEpisodeId: "ep-2",
    choices: [pc({ toEpisodeId: "ep-3" })],
  }),
  ep("b-902", 902, {
    branchOfEpisodeId: "ep-2",
    choices: [pc({ toEpisodeId: "ep-3" })],
  }),
  ep("b-931", 931, { branchOfEpisodeId: "ep-3", choices: [] }),
];
const byId = (id: string) => PAGE.find((e) => e.id === id)!;

describe("listedEpisodes / listedPosition", () => {
  it("lists only the linear run, in array order", () => {
    expect(listedEpisodes(PAGE).map((e) => e.id)).toEqual([
      "ep-1",
      "ep-2",
      "ep-3",
    ]);
  });

  it("positions are 1-based on the listed run and 0 for a branch", () => {
    expect(listedPosition(PAGE, "ep-1")).toBe(1);
    expect(listedPosition(PAGE, "ep-3")).toBe(3);
    expect(listedPosition(PAGE, "b-902")).toBe(0);
    expect(listedPosition(PAGE, "nope")).toBe(0);
  });
});

describe("displayNumber", () => {
  it("prints a listed episode's position", () => {
    expect(displayNumber(PAGE, byId("ep-3"))).toBe(3);
  });

  it("prints the PARENT's number for a branch — never 9xx", () => {
    expect(displayNumber(PAGE, byId("b-901"))).toBe(2);
    expect(displayNumber(PAGE, byId("b-931"))).toBe(3);
  });

  it("walks up nested branches to the listed ancestor", () => {
    const nested = [
      ...PAGE,
      ep("b-921", 921, { branchOfEpisodeId: "b-902", choices: [] }),
    ];
    expect(displayNumber(nested, nested[nested.length - 1])).toBe(2);
  });

  it("falls back to the stored number for an orphan branch", () => {
    const orphan = ep("b-999", 999, { branchOfEpisodeId: "gone" });
    expect(displayNumber([...PAGE, orphan], orphan)).toBe(999);
  });

  it("never loops on a cyclic (invalid) page", () => {
    const a = ep("x", 5, { branchOfEpisodeId: "y" });
    const b = ep("y", 6, { branchOfEpisodeId: "x" });
    expect(displayNumber([a, b], a)).toBe(5);
    expect(listedAncestor([a, b], a)).toBeNull();
  });

  it("listedAncestor is the episode itself when listed, the parent for a branch", () => {
    expect(listedAncestor(PAGE, byId("ep-2"))).toBe(byId("ep-2"));
    expect(listedAncestor(PAGE, byId("b-901"))).toBe(byId("ep-2"));
  });
});

describe("resolveCandidates", () => {
  it("a fork lists its options in position order with the flagged default", () => {
    const c = resolveCandidates(byId("ep-2"), PAGE);
    expect(c.kind).toBe("fork");
    if (c.kind !== "fork") throw new Error("expected fork");
    expect(c.options.map((o) => [o.episode.id, o.label, o.isDefault])).toEqual([
      ["b-901", "Kiss", false],
      ["b-902", "Hug", true],
    ]);
    expect(c.defaultOption.episode.id).toBe("b-902");
  });

  it("falls back to the first option when no row is flagged default", () => {
    const parent = ep("p", 1, {
      choices: [
        pc({ toEpisodeId: "b-901", position: 2 }),
        pc({ toEpisodeId: "b-902", position: 1 }),
      ],
    });
    const c = resolveCandidates(parent, [parent, byId("b-901"), byId("b-902")]);
    if (c.kind !== "fork") throw new Error("expected fork");
    expect(c.defaultOption.episode.id).toBe("b-902");
  });

  it("drops a fork option whose target is not on the page", () => {
    const page = PAGE.filter((e) => e.id !== "b-901");
    const c = resolveCandidates(byId("ep-2"), page);
    // One option left → no prompt, a silent transition to what remains.
    expect(c).toEqual({ kind: "next", episode: byId("b-902") });
  });

  it("a fork with every target gone plays on linearly", () => {
    const page = PAGE.filter((e) => !e.id.startsWith("b-90"));
    expect(resolveCandidates(byId("ep-2"), page)).toEqual({
      kind: "next",
      episode: byId("ep-3"),
    });
  });

  it("a single choice is a silent transition (reconvergence)", () => {
    expect(resolveCandidates(byId("b-901"), PAGE)).toEqual({
      kind: "next",
      episode: byId("ep-3"),
    });
  });

  it("a branch whose only target is gone is an ending, not a linear hop", () => {
    const page = PAGE.filter((e) => e.id !== "ep-3");
    expect(resolveCandidates(byId("b-901"), page)).toEqual({ kind: "end" });
  });

  it("a branch with no choices is an ending", () => {
    expect(resolveCandidates(byId("b-931"), PAGE)).toEqual({ kind: "end" });
  });

  it("the linear rule skips the branches stored after the run", () => {
    expect(resolveCandidates(byId("ep-1"), PAGE)).toEqual({
      kind: "next",
      episode: byId("ep-2"),
    });
    // ep-3 is the last LISTED episode: the array continues with branches,
    // and none of them may follow it by position.
    expect(resolveCandidates(byId("ep-3"), PAGE)).toEqual({ kind: "end" });
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
