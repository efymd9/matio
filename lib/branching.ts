// Branching video (#143) — the rules of the choice graph, universal and PURE.
//
// A branch is an ordinary `episodes` row with `branch_of_episode_id` set; the
// edges live in `episode_choices`. This module decides what a set of edges
// MEANS, what the admin form may write, and what a show must satisfy before
// it can be published. No db, no env: the server actions (app/admin/actions.ts)
// and the admin panel (components/admin/fork-panel.tsx) both import it, and
// every rule here is table-testable (lib/branching.test.ts). The player half
// (#144) reads the same rules through resolveCandidates below — the overlay,
// the timer and the transition live in components/watch/, the DECISION of
// where an episode leads lives here.

export const MAX_CHOICES = 3;
export const FORK_WINDOW_MIN_SECONDS = 3;
export const FORK_WINDOW_MAX_SECONDS = 30;
export const DEFAULT_FORK_WINDOW_SECONDS = 10;
// Numbering convention for branches: from here up, so the (season, number)
// unique key never collides with the linear run. Shown as a hint in the
// admin panel, deliberately not enforced — the viewer-facing number is
// derived from the filtered list (PR 2).
export const BRANCH_NUMBER_FLOOR = 900;

export type EpisodeStatus = "processing" | "ready" | "errored";

// One way out of an episode, as stored in episode_choices.
export type ChoiceEdge = {
  toEpisodeId: string;
  position: number;
  labelEn: string;
  labelEs: string;
  isDefault: boolean;
};

// What happens when an episode ends, decided by the SIZE of its choice set:
//   ≥2 rows — a fork: the prompt is shown, the viewer picks (or the default
//             plays when the timer runs out);
//   1 row   — a silent auto-transition, no prompt (a branch converging back
//             into the shared next episode);
//   0 rows  — a branch is an ending (series-end overlay); a regular episode
//             keeps the linear `episodes[idx + 1]` behaviour.
// This covers v1's reconvergence AND multiple endings with one schema.
//
// Generic over the choice row so the admin side (ChoiceEdge, es+en labels)
// and the player side (PlayerChoice, one localized label) share the rule.
export type NextStep<C = ChoiceEdge> =
  | { kind: "fork"; choices: C[] }
  | { kind: "auto"; toEpisodeId: string }
  | { kind: "ending" }
  | { kind: "linear" };

export function resolveNextStep<
  C extends Pick<ChoiceEdge, "toEpisodeId" | "position">,
>(episode: { branchOfEpisodeId: string | null }, choices: C[]): NextStep<C> {
  const sorted = [...choices].sort((a, b) => a.position - b.position);
  if (sorted.length >= 2) return { kind: "fork", choices: sorted };
  if (sorted.length === 1) {
    return { kind: "auto", toEpisodeId: sorted[0].toEpisodeId };
  }
  return episode.branchOfEpisodeId ? { kind: "ending" } : { kind: "linear" };
}

// ---------- player: candidates, listing, display numbers (#144) ----------

// One option of a fork as the PLAYER receives it: the label is already
// localized by the watch page (app/watch/[showSlug]/page.tsx picks es/en
// from the row; the player never reads the locale for database copy).
export type PlayerChoice = {
  toEpisodeId: string;
  position: number;
  label: string;
  isDefault: boolean;
};

// The subset of the Player's episode DTO these rules read.
export type PlayerEpisodeLike = {
  id: string;
  number: number;
  branchOfEpisodeId: string | null;
  choices: PlayerChoice[] | null;
};

export type ForkOption<E> = {
  episode: E;
  label: string;
  position: number;
  isDefault: boolean;
};

// Where the player goes when `current` ends, resolved against the episodes
// ACTUALLY on the page (ready + playable). A choice whose target is not in
// the array is treated as absent — the publish guard forbids that state,
// but the player must never crash on it, and a fork that lost all but one
// option degrades to a silent transition rather than a one-button prompt.
//   fork — show the prompt; `defaultOption` plays when the timer runs out
//   next — one episode follows (linear run, silent reconvergence, or a
//          degraded fork); nothing is asked
//   end  — nothing follows (last listed episode, or a branch that is an
//          ending): the series-end surface
export type Candidates<E> =
  | { kind: "fork"; options: ForkOption<E>[]; defaultOption: ForkOption<E> }
  | { kind: "next"; episode: E }
  | { kind: "end" };

// The episodes a viewer may pick by position — everything that is not a
// branch. Feeds every list the player renders (episodes overlay, prev/next
// transport, counts) while the full array keeps the branches PLAYABLE.
export function listedEpisodes<
  E extends { branchOfEpisodeId: string | null },
>(episodes: E[]): E[] {
  return episodes.filter((e) => e.branchOfEpisodeId === null);
}

// 1-based position of `id` among the listed episodes; 0 for a branch (or an
// unknown id) — the same answer the server's getOrderedReadyEpisodeIds gives
// the funnel, so `episode_number` on the client events keeps its meaning and
// the Meta Lead check (`position === 1`) can never fire on a branch.
export function listedPosition<
  E extends { id: string; branchOfEpisodeId: string | null },
>(episodes: E[], id: string): number {
  return listedEpisodes(episodes).findIndex((e) => e.id === id) + 1;
}

// The listed episode a branch continues — itself for a listed episode, the
// parent (walking up nested branches) for a branch, null for an orphan
// whose parent is not on the page. The anchor for everything the chrome
// shows by position: the printed number, the "now playing" row of the
// episodes overlay, the prev button.
export function listedAncestor<E extends PlayerEpisodeLike>(
  episodes: E[],
  episode: E,
): E | null {
  const byId = new Map(episodes.map((e) => [e.id, e]));
  let node: E | undefined = episode;
  // Bounded walk: the publish guard refuses cycles, but a stale page could
  // still hold one — never loop forever on a render path.
  for (let hops = 0; node && hops <= episodes.length; hops++) {
    if (node.branchOfEpisodeId === null) return node;
    node = byId.get(node.branchOfEpisodeId);
  }
  return null;
}

// What the chrome PRINTS as the episode number. A listed episode: its
// position. A branch: the number of the episode it continues — its listed
// ancestor's — so the viewer reads "Ep. 3" throughout a fork on episode 3
// and never "Ep. 903". An orphan branch falls back to its stored number.
export function displayNumber<E extends PlayerEpisodeLike>(
  episodes: E[],
  episode: E,
): number {
  const anchor = listedAncestor(episodes, episode);
  return anchor ? listedPosition(episodes, anchor.id) : episode.number;
}

export function resolveCandidates<E extends PlayerEpisodeLike>(
  current: E,
  episodes: E[],
): Candidates<E> {
  const byId = new Map(episodes.map((e) => [e.id, e]));
  const step = resolveNextStep(current, current.choices ?? []);

  if (step.kind === "fork") {
    const options: ForkOption<E>[] = [];
    for (const c of step.choices) {
      const episode = byId.get(c.toEpisodeId);
      if (!episode) continue;
      options.push({
        episode,
        label: c.label,
        position: c.position,
        isDefault: c.isDefault,
      });
    }
    if (options.length >= 2) {
      return {
        kind: "fork",
        options,
        // validateForkDraft always flags exactly one default; the first
        // option stands in should a row ever lose it.
        defaultOption: options.find((o) => o.isDefault) ?? options[0],
      };
    }
    if (options.length === 1) {
      return { kind: "next", episode: options[0].episode };
    }
    // Every target gone — fall through to the zero-row rule below.
  } else if (step.kind === "auto") {
    const episode = byId.get(step.toEpisodeId);
    if (episode) return { kind: "next", episode };
    // Target gone — fall through.
  } else if (step.kind === "ending") {
    return { kind: "end" };
  }

  // Linear: the next LISTED episode. A branch never falls through into the
  // linear run — with its edges gone it is an ending.
  if (current.branchOfEpisodeId !== null) return { kind: "end" };
  const listed = listedEpisodes(episodes);
  const idx = listed.findIndex((e) => e.id === current.id);
  const next = idx >= 0 ? listed[idx + 1] : undefined;
  return next ? { kind: "next", episode: next } : { kind: "end" };
}

// ---------- admin form: parse + validate ----------

export type ChoiceDraft = {
  toEpisodeId: string;
  labelEn: string;
  labelEs: string;
};

export type ForkDraft = {
  branchOfEpisodeId: string | null;
  forkPromptEn: string | null;
  forkPromptEs: string | null;
  forkWindowSeconds: number;
  // Rows in display order, blank rows already dropped.
  choices: ChoiceDraft[];
  // 1-based position of the row the admin marked as default, if any.
  defaultPosition: number | null;
};

// Every other episode of the same show — what a choice or a branch parent
// may point at. The action loads these; the rules below never touch the db.
export type CandidateEpisode = {
  id: string;
  status: EpisodeStatus;
  branchOfEpisodeId: string | null;
};

// Typed codes, rendered inline by the fork panel through the admin
// dictionary's formErrors — never thrown (production masks a thrown
// message behind a digest; the 2026-07-16 incident).
export type ForkErrorCode =
  | "fork_window_out_of_range"
  | "branch_parent_invalid"
  | "too_many_choices"
  | "choice_target_required"
  | "choice_target_invalid"
  | "choice_target_not_ready"
  | "duplicate_choice_target"
  | "fork_needs_two_choices"
  | "fork_prompt_required"
  | "choice_label_required"
  | "choice_target_not_branch";

export type ForkWriteSet = {
  branchOfEpisodeId: string | null;
  forkPromptEn: string | null;
  forkPromptEs: string | null;
  forkWindowSeconds: number;
  choices: ChoiceEdge[];
};

export type ForkValidation =
  | { ok: true; values: ForkWriteSet }
  | { ok: false; code: ForkErrorCode };

// Field names the fork panel submits. Choice rows repeat the three
// `choice*` names once per row (FormData.getAll keeps DOM order); the
// default radio carries the row's 0-based DOM index.
export const FORK_FORM_FIELDS = {
  branchOf: "branchOfEpisodeId",
  promptEn: "forkPromptEn",
  promptEs: "forkPromptEs",
  window: "forkWindowSeconds",
  choiceTarget: "choiceTarget",
  choiceLabelEn: "choiceLabelEn",
  choiceLabelEs: "choiceLabelEs",
  defaultChoice: "defaultChoice",
} as const;

function formString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function formStrings(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((v) => (typeof v === "string" ? v.trim() : ""));
}

export function parseForkForm(formData: FormData): ForkDraft {
  const f = FORK_FORM_FIELDS;
  const targets = formStrings(formData, f.choiceTarget);
  const labelsEn = formStrings(formData, f.choiceLabelEn);
  const labelsEs = formStrings(formData, f.choiceLabelEs);
  const defaultRaw = formString(formData, f.defaultChoice);
  const defaultIndex = defaultRaw === "" ? -1 : Number(defaultRaw);

  const choices: ChoiceDraft[] = [];
  let defaultPosition: number | null = null;
  for (let i = 0; i < targets.length; i++) {
    const row: ChoiceDraft = {
      toEpisodeId: targets[i],
      labelEn: labelsEn[i] ?? "",
      labelEs: labelsEs[i] ?? "",
    };
    // An untouched row (no target, no labels) is not a choice — the panel
    // renders empty rows for adding, and "nothing typed" must not become a
    // "target required" error.
    if (!row.toEpisodeId && !row.labelEn && !row.labelEs) continue;
    choices.push(row);
    if (i === defaultIndex) defaultPosition = choices.length;
  }

  const windowRaw = formString(formData, f.window);
  return {
    branchOfEpisodeId: formString(formData, f.branchOf) || null,
    forkPromptEn: formString(formData, f.promptEn) || null,
    forkPromptEs: formString(formData, f.promptEs) || null,
    forkWindowSeconds:
      windowRaw === "" ? DEFAULT_FORK_WINDOW_SECONDS : Number(windowRaw),
    choices,
    defaultPosition,
  };
}

export function validateForkDraft(
  episodeId: string,
  draft: ForkDraft,
  candidates: CandidateEpisode[],
): ForkValidation {
  const fail = (code: ForkErrorCode): ForkValidation => ({ ok: false, code });

  const window = draft.forkWindowSeconds;
  if (
    !Number.isInteger(window) ||
    window < FORK_WINDOW_MIN_SECONDS ||
    window > FORK_WINDOW_MAX_SECONDS
  ) {
    return fail("fork_window_out_of_range");
  }

  // Self is never a valid target or parent — a one-node loop.
  const byId = new Map(
    candidates.filter((c) => c.id !== episodeId).map((c) => [c.id, c]),
  );

  if (draft.branchOfEpisodeId && !byId.has(draft.branchOfEpisodeId)) {
    return fail("branch_parent_invalid");
  }

  if (draft.choices.length > MAX_CHOICES) return fail("too_many_choices");

  const seen = new Set<string>();
  for (const c of draft.choices) {
    if (!c.toEpisodeId) return fail("choice_target_required");
    const target = byId.get(c.toEpisodeId);
    if (!target) return fail("choice_target_invalid");
    if (target.status !== "ready") return fail("choice_target_not_ready");
    if (seen.has(c.toEpisodeId)) return fail("duplicate_choice_target");
    seen.add(c.toEpisodeId);
  }

  const promptEn = draft.forkPromptEn?.trim() || null;
  const promptEs = draft.forkPromptEs?.trim() || null;
  const base = {
    branchOfEpisodeId: draft.branchOfEpisodeId,
    forkWindowSeconds: window,
  };

  if (draft.choices.length < 2) {
    // A prompt with fewer than two options is a fork the admin has not
    // finished — refuse rather than silently save a silent transition.
    if (promptEn || promptEs) return fail("fork_needs_two_choices");
    return {
      ok: true,
      values: {
        ...base,
        forkPromptEn: null,
        forkPromptEs: null,
        // 0 rows → ending/linear; 1 row → silent auto-transition. Labels are
        // kept if typed (harmless) but nothing reads them without a prompt.
        choices: draft.choices.map((c, i) => ({
          toEpisodeId: c.toEpisodeId,
          position: i + 1,
          labelEn: c.labelEn.trim(),
          labelEs: c.labelEs.trim(),
          isDefault: false,
        })),
      },
    };
  }

  // A real fork: viewer copy in BOTH site locales, and every option must be
  // a branch of THIS episode (a fork into a listed episode would make it
  // reachable twice — by position and by choice).
  if (!promptEn || !promptEs) return fail("fork_prompt_required");
  for (const c of draft.choices) {
    if (!c.labelEn.trim() || !c.labelEs.trim()) {
      return fail("choice_label_required");
    }
    if (byId.get(c.toEpisodeId)!.branchOfEpisodeId !== episodeId) {
      return fail("choice_target_not_branch");
    }
  }
  const n = draft.choices.length;
  const defaultPosition =
    draft.defaultPosition !== null &&
    draft.defaultPosition >= 1 &&
    draft.defaultPosition <= n
      ? draft.defaultPosition
      : 1;
  return {
    ok: true,
    values: {
      ...base,
      forkPromptEn: promptEn,
      forkPromptEs: promptEs,
      choices: draft.choices.map((c, i) => ({
        toEpisodeId: c.toEpisodeId,
        position: i + 1,
        labelEn: c.labelEn.trim(),
        labelEs: c.labelEs.trim(),
        isDefault: i + 1 === defaultPosition,
      })),
    },
  };
}

// ---------- publish guard ----------

export type GraphEpisode = {
  id: string;
  status: EpisodeStatus;
  branchOfEpisodeId: string | null;
  hasForkPrompt: boolean;
};

export type GraphEdge = {
  fromEpisodeId: string;
  toEpisodeId: string;
  position: number;
};

export type PublishGuardCode =
  | "publish_fork_incomplete"
  | "publish_branch_not_ready"
  | "publish_choice_target_not_branch"
  | "publish_branch_cycle";

export type PublishGuardResult =
  | { ok: true }
  | { ok: false; code: PublishGuardCode };

// DFS over the choice graph from every episode a viewer can reach by
// position (ready, not a branch). Refuses: a prompt with fewer than two
// options, a choice into an episode that is not ready, a fork option that is
// not a branch of its parent, and any cycle. Linear fall-through
// (episodes[idx + 1]) is not an edge here — it is strictly increasing and
// cannot loop; the guard is about what CHOICES can do.
export function validateBranchGraph(
  nodes: GraphEpisode[],
  edges: GraphEdge[],
): PublishGuardResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdge[]>();
  for (const e of [...edges].sort((a, b) => a.position - b.position)) {
    const list = out.get(e.fromEpisodeId) ?? [];
    list.push(e);
    out.set(e.fromEpisodeId, list);
  }

  const state = new Map<string, "active" | "done">();
  const visit = (id: string): PublishGuardCode | null => {
    const s = state.get(id);
    if (s === "active") return "publish_branch_cycle";
    if (s === "done") return null;
    state.set(id, "active");

    const node = byId.get(id);
    const choices = out.get(id) ?? [];
    if (node?.hasForkPrompt && choices.length < 2) {
      return "publish_fork_incomplete";
    }
    for (const c of choices) {
      const target = byId.get(c.toEpisodeId);
      if (!target || target.status !== "ready") {
        return "publish_branch_not_ready";
      }
      if (choices.length >= 2 && target.branchOfEpisodeId !== id) {
        return "publish_choice_target_not_branch";
      }
    }
    for (const c of choices) {
      const code = visit(c.toEpisodeId);
      if (code) return code;
    }
    state.set(id, "done");
    return null;
  };

  for (const n of nodes) {
    if (n.branchOfEpisodeId !== null || n.status !== "ready") continue;
    const code = visit(n.id);
    if (code) return { ok: false, code };
  }
  return { ok: true };
}
