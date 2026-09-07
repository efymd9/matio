import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The branching server actions (#143): what they WRITE for a valid fork,
// what they refuse (typed, never thrown), and the publish guard in
// updateShow. The rules themselves are pinned in lib/branching.test.ts;
// here the subject is the glue — the queries the actions issue, the
// transaction they run, the codes they hand back. The query builder is a
// queue-driven fake: every db.select() resolves to the next queued result.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  where: [] as unknown[],
  writes: [] as Array<{
    op: string;
    table: unknown;
    values?: unknown;
    where?: unknown;
  }>,
  txFails: false,
  revalidated: [] as string[],
}));

vi.mock("@/lib/admin", () => ({ requireAdmin: async () => ({ id: "admin-1" }) }));
vi.mock("@/lib/mux", () => ({ getMux: () => ({}) }));
vi.mock("@vercel/blob", () => ({ del: async () => undefined }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    h.revalidated.push(p);
  },
  revalidateTag: () => undefined,
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));

function writer(op: string) {
  return (table: unknown) => {
    const record = (values?: unknown, where?: unknown) => {
      h.writes.push({ op, table, values, where });
    };
    return {
      set: (values: unknown) => ({
        where: async (where: unknown) => record(values, where),
      }),
      where: async (where: unknown) => record(undefined, where),
      values: async (values: unknown) => record(values),
    };
  };
}

function select() {
  const result = h.selects.shift() ?? [];
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: (clause: unknown) => {
      h.where.push(clause);
      return chain;
    },
    orderBy: () => chain,
    limit: async () => result,
    then: (
      resolve: (v: unknown) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

vi.mock("@/db", () => ({
  db: {
    select,
    update: writer("update"),
    delete: writer("delete"),
    insert: writer("insert"),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      if (h.txFails) throw new Error("connection reset");
      return fn({
        select,
        update: writer("update"),
        delete: writer("delete"),
        insert: writer("insert"),
      });
    },
  },
}));
vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => clauses,
  asc: () => undefined,
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: (column: unknown, values: unknown) => ({ inArray: [column, values] }),
  isNull: (column: unknown) => ({ isNull: column }),
  sql: Object.assign(() => undefined, { raw: () => undefined }),
}));

import { episodeChoices, episodes, seasons } from "@/db/schema";
import {
  deleteEpisodeChoice,
  deleteSeason,
  updateShow,
  upsertEpisodeChoices,
} from "./actions";

const EP = "ep-2";
const SEASON = "season-1";
const SHOW = "show-1";
const CHAIN = [{ id: EP }];
const CANDIDATES = [
  { id: "ep-1", status: "ready", branchOfEpisodeId: null, forkPromptEn: null, forkPromptEs: null },
  { id: EP, status: "ready", branchOfEpisodeId: null, forkPromptEn: null, forkPromptEs: null },
  { id: "b-1", status: "ready", branchOfEpisodeId: EP, forkPromptEn: null, forkPromptEs: null },
  { id: "b-2", status: "ready", branchOfEpisodeId: EP, forkPromptEn: null, forkPromptEs: null },
  { id: "ep-3", status: "ready", branchOfEpisodeId: null, forkPromptEn: null, forkPromptEs: null },
];

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

const FORK_FORM = {
  branchOfEpisodeId: "",
  forkPromptEn: "Kiss or hug?",
  forkPromptEs: "¿Beso o abrazo?",
  forkWindowSeconds: "12",
  choiceTarget: ["b-1", "b-2"],
  choiceLabelEn: ["Kiss", "Hug"],
  choiceLabelEs: ["Beso", "Abrazo"],
  defaultChoice: "1",
};

beforeEach(() => {
  h.selects = [];
  h.where = [];
  h.writes = [];
  h.txFails = false;
  h.revalidated = [];
});

describe("upsertEpisodeChoices", () => {
  it("writes the episode's fork columns and replaces its choice set in one transaction", async () => {
    h.selects = [CHAIN, CANDIDATES];
    const result = await upsertEpisodeChoices(
      EP,
      SEASON,
      SHOW,
      { status: "idle" },
      form(FORK_FORM),
    );
    expect(result).toEqual({ status: "ok" });

    expect(h.writes.map((w) => w.op)).toEqual(["update", "delete", "insert"]);
    expect(h.writes[0]).toMatchObject({
      table: episodes,
      values: {
        branchOfEpisodeId: null,
        forkPromptEn: "Kiss or hug?",
        forkPromptEs: "¿Beso o abrazo?",
        forkWindowSeconds: 12,
      },
    });
    expect(h.writes[1].table).toBe(episodeChoices);
    expect(h.writes[2]).toMatchObject({
      table: episodeChoices,
      values: [
        { fromEpisodeId: EP, toEpisodeId: "b-1", position: 1, labelEn: "Kiss", labelEs: "Beso", isDefault: false },
        { fromEpisodeId: EP, toEpisodeId: "b-2", position: 2, labelEn: "Hug", labelEs: "Abrazo", isDefault: true },
      ],
    });
    // The episode page and the season list re-render from the new state.
    expect(h.revalidated).toEqual([
      `/admin/shows/${SHOW}/seasons/${SEASON}/episodes/${EP}`,
      `/admin/shows/${SHOW}/seasons/${SEASON}`,
    ]);
  });

  it("clears the fork when the form comes back empty", async () => {
    h.selects = [CHAIN, CANDIDATES];
    const result = await upsertEpisodeChoices(
      EP,
      SEASON,
      SHOW,
      { status: "idle" },
      form({ branchOfEpisodeId: "ep-1", forkWindowSeconds: "10" }),
    );
    expect(result).toEqual({ status: "ok" });
    expect(h.writes.map((w) => w.op)).toEqual(["update", "delete"]);
    expect(h.writes[0].values).toMatchObject({
      branchOfEpisodeId: "ep-1",
      forkPromptEn: null,
      forkPromptEs: null,
    });
  });

  it("answers a typed code and writes nothing for an invalid fork", async () => {
    // The staging acceptance list: one option, a non-branch target, a
    // not-ready target, a 99-second timer — each an inline error, never the
    // generic error page.
    const cases: Array<[Record<string, string | string[]>, string]> = [
      [{ ...FORK_FORM, choiceTarget: ["b-1"], choiceLabelEn: ["Kiss"], choiceLabelEs: ["Beso"] }, "fork_needs_two_choices"],
      [{ ...FORK_FORM, choiceTarget: ["b-1", "ep-3"] }, "choice_target_not_branch"],
      [{ ...FORK_FORM, forkWindowSeconds: "99" }, "fork_window_out_of_range"],
    ];
    for (const [fields, code] of cases) {
      h.selects = [CHAIN, CANDIDATES];
      h.writes = [];
      const result = await upsertEpisodeChoices(
        EP,
        SEASON,
        SHOW,
        { status: "idle" },
        form(fields),
      );
      expect(result).toEqual({ status: "error", code });
      expect(h.writes).toEqual([]);
    }

    h.selects = [
      CHAIN,
      CANDIDATES.map((c) => (c.id === "b-2" ? { ...c, status: "processing" } : c)),
    ];
    expect(
      await upsertEpisodeChoices(EP, SEASON, SHOW, { status: "idle" }, form(FORK_FORM)),
    ).toEqual({ status: "error", code: "choice_target_not_ready" });
  });

  it("throws on a forged (episode, season, show) chain — an integrity failure, not a form error", async () => {
    h.selects = [[]];
    await expect(
      upsertEpisodeChoices("ep-x", SEASON, SHOW, { status: "idle" }, form(FORK_FORM)),
    ).rejects.toThrow();
    expect(h.writes).toEqual([]);
  });

  it("turns a failed transaction into the generic code instead of a masked throw", async () => {
    h.selects = [CHAIN, CANDIDATES];
    h.txFails = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await upsertEpisodeChoices(
      EP,
      SEASON,
      SHOW,
      { status: "idle" },
      form(FORK_FORM),
    );
    expect(result).toEqual({ status: "error", code: "unknown" });
    spy.mockRestore();
  });
});

describe("deleteEpisodeChoice", () => {
  const EPISODE_ROW = [
    {
      branchOfEpisodeId: null,
      forkPromptEn: "Kiss or hug?",
      forkPromptEs: "¿Beso o abrazo?",
      forkWindowSeconds: 10,
    },
  ];
  const SAVED = [
    { id: "c-1", toEpisodeId: "b-1", labelEn: "Kiss", labelEs: "Beso", isDefault: true },
    { id: "c-2", toEpisodeId: "b-2", labelEn: "Hug", labelEs: "Abrazo", isDefault: false },
    { id: "c-3", toEpisodeId: "b-3", labelEn: "Walk", labelEs: "Paseo", isDefault: false },
  ];
  const WITH_B3 = [
    ...CANDIDATES,
    { id: "b-3", status: "ready", branchOfEpisodeId: EP, forkPromptEn: null, forkPromptEs: null },
  ];

  it("rewrites the remaining options through the fork rules", async () => {
    // Three saved rows, the third pointing at a non-branch (an old, now
    // invalid state); removing IT leaves a valid two-option fork.
    h.selects = [
      CHAIN,
      EPISODE_ROW,
      [...SAVED.slice(0, 2), { ...SAVED[2], toEpisodeId: "ep-3" }],
      CANDIDATES,
    ];
    const result = await deleteEpisodeChoice("c-3", EP, SEASON, SHOW);
    expect(result).toEqual({ status: "ok" });
    expect(h.writes.map((w) => w.op)).toEqual(["update", "delete", "insert"]);
    expect(h.writes[2].values).toEqual([
      { fromEpisodeId: EP, toEpisodeId: "b-1", position: 1, labelEn: "Kiss", labelEs: "Beso", isDefault: true },
      { fromEpisodeId: EP, toEpisodeId: "b-2", position: 2, labelEn: "Hug", labelEs: "Abrazo", isDefault: false },
    ]);
  });

  it("refuses to leave a prompt with a single option", async () => {
    h.selects = [CHAIN, EPISODE_ROW, SAVED.slice(0, 2), CANDIDATES];
    const result = await deleteEpisodeChoice("c-2", EP, SEASON, SHOW);
    expect(result).toEqual({ status: "error", code: "fork_needs_two_choices" });
    expect(h.writes).toEqual([]);
  });

  it("turns a failed rewrite into the generic code, like the save does", async () => {
    h.selects = [CHAIN, EPISODE_ROW, SAVED, WITH_B3];
    h.txFails = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteEpisodeChoice("c-1", EP, SEASON, SHOW)).toEqual({
      status: "error",
      code: "unknown",
    });
    spy.mockRestore();
  });

  it("re-elects the first remaining option as default when the default goes", async () => {
    h.selects = [CHAIN, EPISODE_ROW, SAVED, WITH_B3];
    // c-1 was the default; without it b-2 must inherit, or the timer has
    // nothing to play.
    expect(await deleteEpisodeChoice("c-1", EP, SEASON, SHOW)).toEqual({ status: "ok" });
    const inserted = h.writes[2].values as Array<{ toEpisodeId: string; isDefault: boolean }>;
    expect(inserted.map((c) => [c.toEpisodeId, c.isDefault])).toEqual([
      ["b-2", true],
      ["b-3", false],
    ]);
  });
});

describe("deleteSeason", () => {
  it("drops the choices pointing INTO the season before the cascade, in one transaction", async () => {
    // episode_choices.to_episode_id is RESTRICT and Postgres checks it per
    // cascaded row: a branch physically before its parent, or a fork whose
    // parent lives in another season, made the bare DELETE fail with 23503
    // and the admin got the masked generic error (the 2026-07-16 class).
    await deleteSeason(SEASON, SHOW);

    expect(h.writes.map((w) => [w.op, w.table])).toEqual([
      ["delete", episodeChoices],
      ["delete", seasons],
    ]);
    // Incoming edges: to_episode_id IN (episodes of THIS season of THIS
    // show) — the subquery is scoped so a forged post cannot strip another
    // show's forks.
    const edges = h.writes[0].where as { inArray: [unknown, unknown] };
    expect(edges.inArray[0]).toBe(episodeChoices.toEpisodeId);
    expect(h.where[0]).toContainEqual({ eq: [seasons.id, SEASON] });
    expect(h.where[0]).toContainEqual({ eq: [seasons.showId, SHOW] });
    expect(h.writes[1].where).toContainEqual({ eq: [seasons.id, SEASON] });
    expect(h.writes[1].where).toContainEqual({ eq: [seasons.showId, SHOW] });
    expect(h.revalidated).toEqual([`/admin/shows/${SHOW}`]);
  });

  it("leaves the season in place when the transaction fails", async () => {
    h.txFails = true;
    await expect(deleteSeason(SEASON, SHOW)).rejects.toThrow();
    expect(h.writes).toEqual([]);
  });
});

describe("updateShow — publish guard", () => {
  const SHOW_FORM = { title: "Oath", slug: "the-scarlet-oath", status: "published" };
  const NODES = [
    { id: "ep-1", status: "ready", branchOfEpisodeId: null, forkPromptEn: null, forkPromptEs: null },
    { id: EP, status: "ready", branchOfEpisodeId: null, forkPromptEn: "Kiss or hug?", forkPromptEs: "¿?" },
    { id: "b-1", status: "ready", branchOfEpisodeId: EP, forkPromptEn: null, forkPromptEs: null },
    { id: "b-2", status: "ready", branchOfEpisodeId: EP, forkPromptEn: null, forkPromptEs: null },
    { id: "ep-3", status: "ready", branchOfEpisodeId: null, forkPromptEn: null, forkPromptEs: null },
  ];
  const EDGES = [
    { fromEpisodeId: EP, toEpisodeId: "b-1", position: 1 },
    { fromEpisodeId: EP, toEpisodeId: "b-2", position: 2 },
    { fromEpisodeId: "b-1", toEpisodeId: "ep-3", position: 1 },
    { fromEpisodeId: "b-2", toEpisodeId: "ep-3", position: 1 },
  ];

  it("blocks publishing a show whose choice graph is broken, before any write", async () => {
    const broken: Array<[typeof NODES, typeof EDGES, string]> = [
      [NODES, EDGES.filter((e) => e.toEpisodeId !== "b-2"), "publish_fork_incomplete"],
      [NODES.map((n) => (n.id === "b-1" ? { ...n, status: "processing" } : n)), EDGES, "publish_branch_not_ready"],
      [NODES, [...EDGES, { fromEpisodeId: "ep-3", toEpisodeId: EP, position: 1 }], "publish_branch_cycle"],
    ];
    for (const [nodes, edges, code] of broken) {
      h.selects = [nodes, edges];
      h.writes = [];
      const result = await updateShow(SHOW, { status: "idle" }, form(SHOW_FORM));
      expect(result).toEqual({ status: "error", code });
      expect(h.writes).toEqual([]);
    }
  });

  it("lets a sound graph publish — and stamps released_at on listed episodes only", async () => {
    // Guard queries, then updateShow's own prev-row snapshot.
    h.selects = [NODES, EDGES, [{ posterImageUrl: null, heroImageUrl: null, status: "draft" }]];
    const result = await updateShow(SHOW, { status: "idle" }, form(SHOW_FORM));
    expect(result).toEqual({ status: "ok" });

    // The draft → published edge stamps release dates; a branch is not a
    // release (no pulse marker, no release-retention row), so the stamp's
    // WHERE leaves branches out.
    const stamp = h.writes.find(
      (w) =>
        w.op === "update" &&
        w.table === episodes &&
        typeof (w.values as { releasedAt?: unknown })?.releasedAt !== "undefined",
    );
    expect(stamp).toBeDefined();
    expect(stamp!.where).toContainEqual({ isNull: episodes.branchOfEpisodeId });
    expect(stamp!.where).toContainEqual({ eq: [episodes.status, "ready"] });
  });

  it("stamps nothing on a routine edit of an already-published show", async () => {
    h.selects = [NODES, EDGES, [{ posterImageUrl: null, heroImageUrl: null, status: "published" }]];
    await updateShow(SHOW, { status: "idle" }, form(SHOW_FORM));
    expect(
      h.writes.some(
        (w) => typeof (w.values as { releasedAt?: unknown })?.releasedAt !== "undefined",
      ),
    ).toBe(false);
  });

  it("does not consult the graph when saving a draft", async () => {
    h.selects = [[{ posterImageUrl: null, heroImageUrl: null, status: "draft" }]];
    const result = await updateShow(
      SHOW,
      { status: "idle" },
      form({ ...SHOW_FORM, status: "draft" }),
    );
    expect(result).toEqual({ status: "ok" });
    expect(h.selects).toEqual([]);
  });
});
