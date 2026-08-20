# Creator Portal (`creator.matio.tv`) — Implementation Plan

> Status: **PLAN — not yet implemented.** Finalized 2026-06-16 via a design brainstorm.
> A YouTube-creator-style portal where approved creators manage their own shows/episodes
> and see engagement analytics, with admin moderation gating everything before it goes public.

## 1. Product spec (confirmed decisions)

| Area | Decision |
|---|---|
| Creators | **Open self-signup**, but admin must **approve the account** before a creator can create shows / upload video |
| Payouts | **None in v1** (data model kept payout-ready: `owner_user_id` is the join key a later payouts feature reads from) |
| Ownership | **Single owner per show** — `shows.owner_user_id` nullable; `NULL` = existing studio content (admin-only) |
| Moderation | **Show shell reviewed once** (title/description/artwork) + **per-episode** review; editing approved content triggers **re-review** |
| Live edits | **Keep the old approved version live** while an edit is re-reviewed (staging layer) |
| Monetization | **Admin sets the access tier** (free/member/subscriber) at approval time — creators cannot set it |
| Identity | **Byline only** — `users.display_name` shown as plain text on the public show page; no public profile routes |
| Analytics | **Engagement only**, scoped to own shows; no platform revenue/subscriber data |
| Notifications | **In-portal status only** (Resend is not wired; do not add an email dependency) |
| Auth | **Shared Clerk user pool**; `creator.matio.tv` is the **same Next app**, host-gated + creator-status check |
| Edit staging | **`content_revisions` table** (not `pending_*` mirror columns) |
| Mux capacity | **Upgrade off the free 10-asset cap + add per-creator quotas before launch** |
| Legal | **Draft a bilingual Creator Agreement + signup consent checkbox** (marked DRAFT, counsel-pending, like `/terms`) |

## 2. The core model: three orthogonal axes on content

Conflating any two of these breaks something. `ready` must **never** imply "publicly playable."

| Axis | Column | Meaning | Set by |
|---|---|---|---|
| Transcode | `episodes.status` (`processing/ready/errored`) | Is the video encoded? | Mux webhook |
| Tier | `episodes.access` (`free/member/subscriber`) | Who may watch? | **Admin, at approval** |
| Moderation | `episodes.moderation_status` (**new**) | Has a human approved it? | Admin review |

Public playability = `status='ready' AND moderation_status='approved' AND access-allows`.
The Mux webhook keeps flipping `status='ready'` on transcode but must **never** touch `moderation_status`.

## 3. Architecture decisions

- **Ownership FK type:** `shows.owner_user_id text references users.id` — Clerk ids are **`text`, not uuid** (matches `subscriptions.userId` / `watch_progress.userId`). Nullable. `NULL` = studio content, admin-only, treated as pre-approved. **Do not backfill an owner onto existing shows.**
- **ON DELETE:** `SET NULL` — deleting a creator orphans their shows to studio ownership, not out of the catalog.
- **Visibility predicate everywhere:** `(owner_user_id IS NULL OR <approved>)`. A naive `WHERE approved` erases the entire existing live catalog on deploy.
- **Creator status:** new `users.creator_status` enum `['none','pending','approved','rejected','suspended']`, default `'none'`. **Separate from `userRole`** (`user/admin`) — a person can be both; `proxy.ts` reads `role` independently. `suspended` is in v1.
- **Routing:** `creator.matio.tv` rewrites to a `/creator/*` path prefix, **host-enforced in `proxy.ts`** (reachable only via that host, mirroring the `LEGACY_ALIAS_HOST` exact-match at `proxy.ts:164`). Same deployment, shared Clerk pool.
- **Locale:** creator UI reuses the **public es/en** system (ES default) — *not* the Russian-default admin i18n (`lib/i18n/admin-*`).
- **Byline:** single `users.display_name` (one byline per creator), plain text on the public show page.
- **Publish semantics:** creators cannot set `status`. A creator show goes public when **shell approved AND ≥1 approved+ready episode**; the admin shell-approval action sets `shows.status='published'`. Approved creator shows flow into the **same public catalog** as studio content, attributed by byline.

## 4. Data model — migration 0020 (additive only; next number is 0020)

```
users:     + creator_status enum (default 'none')
           + display_name text (nullable)
shows:     + owner_user_id text FK→users.id (nullable, ON DELETE SET NULL)
           + shell_review_status enum ['draft','pending','approved','rejected'] (default 'draft')
           + reviewed_by text FK→users.id, reviewed_at timestamptz, reviewer_notes text
episodes:  + moderation_status enum ['pending','approved','rejected'] (default 'pending')
           + reviewed_by text FK→users.id, reviewed_at timestamptz, reviewer_notes text
+ content_revisions  (see §5)
```

**Backfill in the same migration:** every existing show → `shell_review_status='approved'`; every existing episode → `moderation_status='approved'`. Without it the live catalog vanishes.

**Deploy discipline (drizzle drop-column-outage rule, safe ADD direction):** all public/admin reads do full-row `db.select()` which bakes the column list into the build. Run `db:generate` → `db:migrate` on **every env BEFORE** deploying code that selects the new columns. Every new column is nullable or has a default so the pre-migrate build is unaffected.

## 5. Edit staging — `content_revisions` (the "keep old version live" layer)

Chosen over `pending_*` mirror columns because public reads do full-row `select()` at ~13 sites
(`catalog.ts:27`, `show-query.ts:16`, watch page, public show page, admin pages) — mirror columns
would double the build-baked column set on all of them. The revisions table keeps live tables
pristine; only the creator editor + admin review screen pay a join.

```
content_revisions(
  id uuid pk,
  entity_type 'show' | 'episode',
  entity_id uuid,
  proposed jsonb,                 -- proposed editable field values
  staged_mux_asset_id text,       -- staged new video (episode re-upload), NULL otherwise
  staged_mux_playback_id text,
  status 'pending' | 'approved' | 'rejected' (default 'pending'),
  created_at timestamptz,
  reviewed_by text, reviewed_at timestamptz, reviewer_notes text
)
```

- Editing an approved show field or episode writes a **revision**, not the live row; the entity displays "edit pending" but **live values keep serving the public**.
- **Video re-upload:** for creator episodes, `markEpisodeReprocessing` must **not** clear the live `muxPlaybackId` (that pulls the live video offline). The new asset stages into `staged_mux_*`; the old keeps playing until approval.
- **Approve:** apply `proposed`/staged → live row, clear revision, `revalidateTag(CATALOG_TAG,'default')` + revalidate `/`, `/shows/<slug>`, `/watch/<slug>`.
- **Reject:** drop the revision; live untouched.
- `updateShow`'s eager `deleteOrphanedBlob` (`app/admin/actions.ts:171`) must **not** delete the old poster/hero on a *pending* artwork change — only on approval.

## 6. Read-side visibility wall — every site (none optional)

`app/api/playback-token/route.ts:61-78` is the **only real enforcement wall** (its own comment says the watch page is belt-and-braces). Each site needs `(owner_user_id IS NULL OR shell approved)` and/or `episodes.moderation_status='approved'`:

1. **`app/api/playback-token/route.ts:61-78`** — highest priority; a leaked unapproved episode id currently mints a token. The select (lines 62-66) must also fetch + require moderation/shell approval.
2. `lib/catalog.ts:24-31` `getPublishedShows` (home + sitemap, `unstable_cache` tag `catalog`) — bust the tag on approval transitions.
3. `lib/show-query.ts:14-27` `getShowBySlug` (show page body + `generateMetadata` + opengraph-image). Not cache-tagged → flips instantly (diverges from catalog's 1h lag).
4. `app/watch/[showSlug]/page.tsx` — show query (~40-50) + ready-episodes (~66-88) + the `gated` derivation (~106) + the playable list.
5. `app/(public)/shows/[slug]/page.tsx` — its **own** seasons/episodes sub-query (~86-111).
6. `app/(public)/page.tsx` — home hero's **own** episode sub-query (~73-97) for the hero JWT.
7. `app/watch/actions.ts` — `saveWatchProgress` (52-69), `saveTrialPosition` (118-134), `subscribeToShowReminder` (236-247; also leaks show-id existence via error differentiation).
8. `lib/checkout-target.ts` — `resolveCheckoutTarget` show match (34-45) + episode match (50-63) for Stripe deep-links.
9. `lib/episode-access.ts` — `getOrderedReadyEpisodeIds` (18-28) + `showHasTierGating` (34-48); both currently filter only `status='ready'` and must exclude unapproved or tier-gating mis-derives. Called from the token route + `watch/actions.ts:152,171`.
10. `app/sitemap.ts` — auto-fixed via `getPublishedShows`; re-verify it adds no own query.

Not a public leak but must be owner-scoped: `lib/admin-analytics.ts` `loadDashboard` (shows ~486-489, watch_progress join ~839) + `loadEpisodeFunnels` (~1063+, ~1076-1079).

## 7. Auth + host gating (`proxy.ts`, `lib/admin.ts`)

- Fold `creator_status` into the **existing** `getUserRoleCached` SELECT (`proxy.ts:43-58`, 5s module cache) — do **not** add a second uncached Neon round-trip per request. Accept ≤5s stale `pending` after approval.
- Host branch for `creator.matio.tv` (read `req.headers.get("host")`, like `proxy.ts:164`): require `userId` (→ `redirectToSignIn`), require `creator_status='approved'` (else → pending/landing page, **not** `/`).
- **Branch `applyMarketingCookies` (`proxy.ts:195-198`) off the creator host** — internal tool like `/admin`; don't load pixels or write UTM cookies there.
- New `lib/admin.ts` helpers `getCurrentCreator()` / `requireApprovedCreator()`, same shape as `getCurrentAdmin`/`requireAdmin`. Reuse `getOrSyncCurrentUser` (handles Clerk-webhook lag).
- **Clerk dashboard config (not code):** session cookie domain = registrable root `.matio.tv`; add `creator.matio.tv` to allowed origins/redirect URLs, or SSO breaks on the subdomain.

## 8. Admin moderation surface (`app/admin/moderation`)

New owner-**unscoped** queue across all creators: pending show shells + pending episodes + pending revisions. Actions:
- Approve/reject show shell (approve sets `status='published'` + busts catalog).
- **Approve episode while setting its access tier** in one action (reuse `episodeAccess.enumValues` validation, `actions.ts:346,394`) → flips `moderation_status='approved'`.
- Promote/reject pending revisions (§5).
- New `ModerationStatusBadge` (model: `EpisodeStatusBadge`). Owner byline shown on the show edit page. Add nav link in `app/admin/layout.tsx`.

## 9. Creator write surface (`app/creator`) — fork, don't reuse admin actions

Admin actions (`app/admin/actions.ts`) trust `requireAdmin`, don't owner-scope, and read `status/featured/justReleased/popularNow` + `access` straight from the form — exposing them lets a creator self-publish. So:

- **New `app/creator/actions.ts`** — each action `requireApprovedCreator()` + `shows.owner_user_id = caller` added to the existing chain-verify pattern (`actions.ts:354-366` etc., which only guards id-mismatch under a single trusted admin). **Strip `status/featured/justReleased/popularNow/access` server-side** (never trust the client to hide them).
- Edits to approved content route through `content_revisions` (§5), not live rows.
- **Reuse `components/admin/upload-widget.tsx` verbatim**, gated by ownership + approved status. `createMuxUpload` (`actions.ts:447-486`) gated behind `approved` + ownership — this is the Mux-cost wall.
- Fork a creator `ShowForm` that omits `status/featured/flags` and the `AccessFormSelect`.
- Creator artwork: relax `app/api/admin/upload-image/route.ts` (`getCurrentAdmin`-gated) to admin-OR-approved-creator, or add a sibling route with the same content-type/size/pathname pinning.
- `app/creator/layout.tsx` = `requireApprovedCreator()` + creator chrome; keep `components/admin/ui.tsx`'s server-only discipline for any shared dict-reading UI.
- Self-signup flow sets `creator_status='pending'`; neither the Clerk webhook nor `getOrSyncCurrentUser` may auto-approve.

## 10. Creator analytics — engagement only (`app/creator/analytics`)

`loadDashboard` mixes engagement + **revenue/MRR/subscriber/conversion** in one function — hiding fields client-side still ships the data. So:
- **Extract a new owner-scoped `loadEngagement(showIds)`**: completion rate, distinct viewers, per-episode drop-off (`depth[]`), reusing the `watch_progress` joins that already support a single-show filter (`wpShowCond = eq(seasons.showId, showId)`).
- Strip `loadEpisodeFunnels`' `signedUp/subscribed/paywallHit` conversion stages; keep `depth[]` + per-episode viewers/completion.
- Optional per-owner Mux Data via `lib/mux-data.ts` (keep the Basic-auth / `cache(300s)` / `AbortSignal.timeout(3500)` / Suspense-island contract).
- **Caveats to surface:** `watch_progress.position_seconds` is a resume playhead, not cumulative watch time (label "approx"); the Mux per-show key is `video_series = show *title*` (`player.tsx:1355`) — mutable/non-unique. **Switch it to show id/slug before creators depend on it** (history won't backfill).

## 11. Build sequence (lowest-risk first)

- **Phase 0** — migration 0020 + all-approved backfill; `db:migrate` on every env.
- **Phase 1** — read-side gating at all §6 sites (token route first). No-op with the backfill; de-risks the wall before any creator exists.
- **Phase 2** — `proxy.ts` host gate + `creator_status` in the cache + `lib/admin.ts` helpers + Clerk subdomain config. Verify SSO before any UI.
- **Phase 3** — admin moderation queue + approval/revision actions. Review capability before opening writes.
- **Phase 4** — creator write surface + self-signup→pending. **Gated behind the Mux plan upgrade + quotas.**
- **Phase 5** — creator engagement analytics.
- **Phase 6** — Creator Agreement page + signup consent + acceptance tracking; in-portal status notifications (DB-backed, no Resend); per-creator upload quotas.

## 12. Hard go-live blockers (not code)

1. **Mux free 10-asset account-wide cap** (hit 10/10 on 2026-06-03; single shared credential, no per-user accounting, soft-delete doesn't free assets). Open uploads are impossible until a paid plan + app-level per-creator quotas exist.
2. **Clerk** `.matio.tv` cookie domain + `creator.matio.tv` allowed origins.
3. **Creator Agreement** (UGC licensing/takedown/acceptable-use) — none exists today; draft + consent checkbox required before public launch.

## 13. Risks / gotchas to respect

- Token route is the load-bearing wall — gating render but not issuance still leaks.
- `owner_user_id` nullability is load-bearing — `NULL` = admin-exclusive; creators must never see/edit/list a null-owner show.
- `episodes.status` is Mux state, not visibility — keep moderation a separate column or the webhook + re-upload safety break.
- Soft-delete forces `status='draft'` alongside `deletedAt` (`actions.ts:229`); define how shell-review/revisions interact (clear pending on delete; a pending show can't be featured; approval must not auto-publish a deleted show). Owner-scope even on soft-deleted rows.
- Open self-signup account-creation surface has no rate limiting today (only guest-checkout is limited) — consider abuse handling on signup; upload-gating-behind-approval covers the Mux-cost vector.
