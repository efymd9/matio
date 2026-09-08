import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The episode form actions (#193). What matters here is the CONTRACT, not
// the SQL: everything an admin can type wrong must come back as a code the
// form renders inline. A throw would reach them as the generic error page
// with only a digest — which is exactly how a duplicate episode number
// showed up in production on 2026-09-08.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  writes: [] as Array<{ op: string; values?: unknown }>,
  insertFails: null as unknown,
  updateFails: null as unknown,
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

function select() {
  const result = h.selects.shift() ?? [];
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
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
    insert: () => ({
      values: async (values: unknown) => {
        if (h.insertFails) throw h.insertFails;
        h.writes.push({ op: "insert", values });
      },
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          if (h.updateFails) throw h.updateFails;
          h.writes.push({ op: "update", values });
        },
      }),
    }),
    delete: () => ({ where: async () => undefined }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn({}),
  },
}));
vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => clauses,
  asc: () => undefined,
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: () => undefined,
  isNull: () => undefined,
  sql: Object.assign(() => undefined, { raw: () => undefined }),
}));

import { createEpisode, updateEpisode } from "./actions";

const SEASON = "season-1";
const SHOW = "show-1";
const EPISODE = "ep-1";
const IDLE = { status: "idle" } as const;

// Drizzle 0.44+ hands the driver error over on `.cause`; the code is never
// on the thrown error itself (lib/db-errors.ts).
function uniqueViolation() {
  return Object.assign(new Error("insert failed"), {
    cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
  });
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

const VALID_NEW = { number: "2", title: "Ep 2", description: "" };
const VALID_EDIT = {
  number: "2",
  title: "Ep 2",
  description: "",
  access: "free",
};

beforeEach(() => {
  h.selects = [];
  h.writes = [];
  h.insertFails = null;
  h.updateFails = null;
  h.revalidated = [];
});

describe("createEpisode — typed errors, never a masked throw", () => {
  it("inserts and reports ok when the number is free", async () => {
    h.selects.push([{ id: SEASON }]);

    const state = await createEpisode(SEASON, SHOW, IDLE, form(VALID_NEW));

    expect(state).toEqual({ status: "ok" });
    expect(h.writes).toEqual([
      {
        op: "insert",
        values: {
          seasonId: SEASON,
          number: 2,
          title: "Ep 2",
          description: null,
        },
      },
    ]);
    expect(h.revalidated).toContain(`/admin/shows/${SHOW}/seasons/${SEASON}`);
  });

  it("answers episode_number_taken when the season already holds that number", async () => {
    h.selects.push([{ id: SEASON }]);
    h.insertFails = uniqueViolation();

    const state = await createEpisode(SEASON, SHOW, IDLE, form(VALID_NEW));

    expect(state).toEqual({ status: "error", code: "episode_number_taken" });
    // Nothing written, and no revalidation claiming a change happened.
    expect(h.writes).toEqual([]);
    expect(h.revalidated).toEqual([]);
  });

  it("re-throws a database failure that is not a duplicate number", async () => {
    h.selects.push([{ id: SEASON }]);
    h.insertFails = Object.assign(new Error("connection reset"), {
      cause: Object.assign(new Error("57P01"), { code: "57P01" }),
    });

    await expect(
      createEpisode(SEASON, SHOW, IDLE, form(VALID_NEW)),
    ).rejects.toThrow("connection reset");
  });

  it("answers title_required for a whitespace-only title, without touching the database", async () => {
    const state = await createEpisode(
      SEASON,
      SHOW,
      IDLE,
      form({ ...VALID_NEW, title: "   " }),
    );

    expect(state).toEqual({ status: "error", code: "title_required" });
    expect(h.writes).toEqual([]);
  });

  it.each([
    ["blank", ""],
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "2.5"],
  ])("answers episode_number_invalid for a %s number", async (_label, value) => {
    const state = await createEpisode(
      SEASON,
      SHOW,
      IDLE,
      form({ ...VALID_NEW, number: value }),
    );

    expect(state).toEqual({ status: "error", code: "episode_number_invalid" });
    expect(h.writes).toEqual([]);
  });

  it("still throws when the (season, show) pair does not exist — a forged post, not a typo", async () => {
    h.selects.push([]);

    await expect(
      createEpisode(SEASON, "other-show", IDLE, form(VALID_NEW)),
    ).rejects.toThrow("Season not found");
  });
});

describe("updateEpisode — same contract on the edit form", () => {
  it("saves and reports ok", async () => {
    h.selects.push([{ id: EPISODE }]);

    const state = await updateEpisode(
      EPISODE,
      SEASON,
      SHOW,
      IDLE,
      form(VALID_EDIT),
    );

    expect(state).toEqual({ status: "ok" });
    expect(h.writes[0]?.op).toBe("update");
    // Both surfaces the edit can change: the episode page and the season
    // list that prints its number and title.
    expect(h.revalidated).toEqual([
      `/admin/shows/${SHOW}/seasons/${SEASON}/episodes/${EPISODE}`,
      `/admin/shows/${SHOW}/seasons/${SEASON}`,
    ]);
  });

  it("drops a half-filled intro pair to null on both columns", async () => {
    h.selects.push([{ id: EPISODE }]);

    // The skip-intro chip needs both markers; a lone start is not a
    // partial setting, it is no setting.
    const state = await updateEpisode(
      EPISODE,
      SEASON,
      SHOW,
      IDLE,
      form({ ...VALID_EDIT, introStartSeconds: "5" }),
    );

    expect(state).toEqual({ status: "ok" });
    expect(h.writes[0]?.values).toMatchObject({
      introStartSeconds: null,
      introEndSeconds: null,
    });
  });

  it("answers episode_number_taken when renumbering onto a taken slot", async () => {
    h.selects.push([{ id: EPISODE }]);
    h.updateFails = uniqueViolation();

    const state = await updateEpisode(
      EPISODE,
      SEASON,
      SHOW,
      IDLE,
      form(VALID_EDIT),
    );

    expect(state).toEqual({ status: "error", code: "episode_number_taken" });
    expect(h.revalidated).toEqual([]);
  });

  it.each([
    ["end before start", { introStartSeconds: "30", introEndSeconds: "10" }],
    ["equal markers", { introStartSeconds: "30", introEndSeconds: "30" }],
    ["negative start", { introStartSeconds: "-1", introEndSeconds: "10" }],
    ["fractional end", { introStartSeconds: "1", introEndSeconds: "10.5" }],
  ])(
    "answers intro_markers_invalid for %s",
    async (_label, markers: Record<string, string>) => {
      const state = await updateEpisode(
        EPISODE,
        SEASON,
        SHOW,
        IDLE,
        form({ ...VALID_EDIT, ...markers }),
      );

      expect(state).toEqual({ status: "error", code: "intro_markers_invalid" });
      expect(h.writes).toEqual([]);
    },
  );

  it("keeps a valid intro pair and stores both markers", async () => {
    h.selects.push([{ id: EPISODE }]);

    const state = await updateEpisode(
      EPISODE,
      SEASON,
      SHOW,
      IDLE,
      form({ ...VALID_EDIT, introStartSeconds: "5", introEndSeconds: "20" }),
    );

    expect(state).toEqual({ status: "ok" });
    expect(h.writes[0]?.values).toMatchObject({
      introStartSeconds: 5,
      introEndSeconds: 20,
    });
  });

  it("still throws for a forged access tier", async () => {
    await expect(
      updateEpisode(
        EPISODE,
        SEASON,
        SHOW,
        IDLE,
        form({ ...VALID_EDIT, access: "vip" }),
      ),
    ).rejects.toThrow("Invalid access tier");
  });
});
