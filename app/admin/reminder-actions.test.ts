import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The reminder dispatch re-verifies the announced episode server-side
// before a single address is claimed. What is pinned here is that
// verification — the WHERE it issues and the typed refusal it answers — for
// the one case #143 adds: a branch episode. Its ?ep= deep link lands on
// episode 1, so an email announcing "S1E901" would be a dead link in every
// inbox; the picker hides branches and this is the belt-and-braces.
const h = vi.hoisted(() => ({
  target: [] as unknown[],
  where: [] as unknown[],
  claims: 0,
  sent: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireAdmin: async () => ({ id: "admin-1" }) }));
vi.mock("@/lib/resend", () => ({
  resendConfigured: () => true,
  getResend: () => ({ batch: { send: h.sent } }),
  emailFrom: () => "Matio <updates@example.test>",
  emailReplyTo: () => "contact@example.test",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/db", () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: (clause: unknown) => {
          h.where.push(clause);
          return chain;
        },
        limit: async () => h.target,
      };
      return chain;
    },
    // The claim UPDATE … RETURNING — must never be reached for a refused
    // episode.
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            h.claims += 1;
            return [];
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({
  episodes: {
    id: "episodes.id",
    number: "episodes.number",
    title: "episodes.title",
    description: "episodes.description",
    durationSeconds: "episodes.duration_seconds",
    muxPlaybackId: "episodes.mux_playback_id",
    muxPlaybackPolicy: "episodes.mux_playback_policy",
    seasonId: "episodes.season_id",
    status: "episodes.status",
    branchOfEpisodeId: "episodes.branch_of_episode_id",
  },
  seasons: { id: "seasons.id", showId: "seasons.show_id", number: "seasons.number" },
  shows: {
    id: "shows.id",
    title: "shows.title",
    slug: "shows.slug",
    genre: "shows.genre",
    status: "shows.status",
    deletedAt: "shows.deleted_at",
  },
  showReminders: {
    id: "show_reminders.id",
    showId: "show_reminders.show_id",
    notifiedAt: "show_reminders.notified_at",
    createdAt: "show_reminders.created_at",
    email: "show_reminders.email",
    locale: "show_reminders.locale",
  },
}));
vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => clauses,
  asc: () => undefined,
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: () => undefined,
  isNull: (column: unknown) => ({ isNull: column }),
}));

import { episodes, shows } from "@/db/schema";
import { sendShowReminders } from "./reminder-actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  h.target = [];
  h.where = [];
  h.claims = 0;
  h.sent.mockReset();
});

describe("sendShowReminders — episode verification", () => {
  it("refuses a branch id with episode_invalid and claims nothing", async () => {
    // The verification query yields no row for a branch (the filter lives
    // in its WHERE), so the action stops before the first claim or send.
    const result = await sendShowReminders(
      { status: "idle" },
      form({ showId: "show-1", episodeId: "b-901" }),
    );
    expect(result).toEqual({ status: "error", code: "episode_invalid", sent: 0 });
    expect(h.claims).toBe(0);
    expect(h.sent).not.toHaveBeenCalled();

    const [clause] = h.where as unknown[][];
    expect(clause).toContainEqual({ eq: [episodes.id, "b-901"] });
    expect(clause).toContainEqual({ eq: [episodes.status, "ready"] });
    expect(clause).toContainEqual({ isNull: episodes.branchOfEpisodeId });
    expect(clause).toContainEqual({ eq: [shows.status, "published"] });
  });

  it("refuses a blank form the same way", async () => {
    const result = await sendShowReminders({ status: "idle" }, form({ showId: "show-1" }));
    expect(result).toEqual({ status: "error", code: "episode_invalid", sent: 0 });
    expect(h.where).toEqual([]);
  });
});
