import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The two actions the show and season pages post to that used to throw on
// input a real admin can produce (#195): createSeason on a taken season
// number (23505 straight into the masked generic error page — the #193
// class), and deleteEpisode from the season page for an episode some choice
// leads to (the RESTRICT FK, 23503). The contract under test: typed codes,
// nothing written on a refusal, and the redirect after a real delete.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  writes: [] as Array<{ op: string; values?: unknown; where?: unknown }>,
  insertFails: null as unknown,
  revalidated: [] as string[],
  redirected: [] as string[],
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
// What next/navigation really does: redirect() THROWS a NEXT_REDIRECT error
// that the server-action transport turns into the navigation. The action has
// to let it out — a caught one is no redirect at all — and must never reach
// it on the typed path, or the admin would be sent away from the message.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirected.push(to);
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;push;${to};307;`,
    });
  },
}));

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
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({
      where: async (where: unknown) => {
        h.writes.push({ op: "delete", where });
      },
    }),
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

import { episodes } from "@/db/schema";
import { createSeason, deleteEpisode } from "./actions";

const SHOW = "show-1";
const SEASON = "season-1";
const EPISODE = "ep-1";
const SEASON_PATH = `/admin/shows/${SHOW}/seasons/${SEASON}`;
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

beforeEach(() => {
  h.selects = [];
  h.writes = [];
  h.insertFails = null;
  h.revalidated = [];
  h.redirected = [];
});

describe("createSeason — typed errors, never a masked throw", () => {
  it("inserts and reports ok when the number is free, and refreshes the show page", async () => {
    const state = await createSeason(
      SHOW,
      IDLE,
      form({ number: "2", title: "Second" }),
    );

    expect(state).toEqual({ status: "ok" });
    expect(h.writes).toEqual([
      {
        op: "insert",
        values: { showId: SHOW, number: 2, title: "Second", description: null },
      },
    ]);
    expect(h.revalidated).toEqual([`/admin/shows/${SHOW}`]);
  });

  it("answers season_number_taken when the show already has that season", async () => {
    h.insertFails = uniqueViolation();

    const state = await createSeason(SHOW, IDLE, form({ number: "1" }));

    expect(state).toEqual({ status: "error", code: "season_number_taken" });
    // Nothing written, and no revalidation claiming a change happened.
    expect(h.writes).toEqual([]);
    expect(h.revalidated).toEqual([]);
  });

  it("re-throws a database failure that is not a duplicate number", async () => {
    h.insertFails = Object.assign(new Error("connection reset"), {
      cause: Object.assign(new Error("57P01"), { code: "57P01" }),
    });

    await expect(
      createSeason(SHOW, IDLE, form({ number: "3" })),
    ).rejects.toThrow("connection reset");
  });

  it.each([
    ["blank", ""],
    ["zero", "0"],
    ["negative", "-1"],
    ["fractional", "2.5"],
  ])("answers season_number_invalid for a %s number", async (_label, value) => {
    const state = await createSeason(SHOW, IDLE, form({ number: value }));

    expect(state).toEqual({ status: "error", code: "season_number_invalid" });
    expect(h.writes).toEqual([]);
  });
});

describe("deleteEpisode — the choice-target refusal is a code, a real delete redirects", () => {
  it("refuses an episode some choice leads to: no DELETE, no redirect, the code for the row", async () => {
    h.selects.push([{ id: EPISODE }]); // the (episode, season, show) chain
    h.selects.push([{ id: "choice-1" }]); // …and an edge pointing at it

    const state = await deleteEpisode(EPISODE, SEASON, SHOW);

    expect(state).toEqual({
      status: "error",
      code: "episode_is_choice_target",
    });
    expect(h.writes).toEqual([]);
    expect(h.redirected).toEqual([]);
    expect(h.revalidated).toEqual([]);
  });

  it("deletes an ordinary episode and redirects to the season list", async () => {
    h.selects.push([{ id: EPISODE }]);
    h.selects.push([]); // nobody's choice leads here

    // The redirect surfaces as the NEXT_REDIRECT throw next/navigation
    // makes — that is the success path, not a failure.
    await expect(deleteEpisode(EPISODE, SEASON, SHOW)).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });

    expect(h.writes).toEqual([
      { op: "delete", where: { eq: [episodes.id, EPISODE] } },
    ]);
    expect(h.revalidated).toEqual([SEASON_PATH]);
    expect(h.redirected).toEqual([SEASON_PATH]);
  });

  it("still throws when the (episode, season, show) chain does not hold — a forged post", async () => {
    h.selects.push([]);

    await expect(
      deleteEpisode(EPISODE, SEASON, "other-show"),
    ).rejects.toThrow("Episode not in this season/show");
    expect(h.writes).toEqual([]);
    expect(h.redirected).toEqual([]);
  });
});
