# Matio Mobile App (iOS + Android) — Implementation Plan

> Status: **PLAN — not yet implemented.** Decided 2026-07-29 via a design brainstorm.
> A native iOS + Android app built with **Expo / React Native**, targeting full parity
> with matio.tv: catalog, player, offline downloads, casting, PiP, and push notifications.
> The site stays the primary surface; the app is the retention + acquisition layer.

## 1. Product spec (confirmed decisions)

| Area | Decision |
|---|---|
| Framework | **Expo / React Native** (see §2 for why, and what was rejected) |
| Monetization | **Free forever.** No IAP, no StoreKit/Play Billing, no purchase surfaces, no pricing copy in-app. Matches `PAYMENTS_ENABLED` unset. |
| Scope | **Full parity** with matio.tv, phased (see §12) |
| Goals | All four: retention/push · App Store acquisition · playback quality (offline/cast/PiP) · brand legitimacy |
| Player | `react-native-video` (native AVPlayer / Media3 under a JS API) + `@mux/mux-data-react-native-video` |
| Auth | `@clerk/expo` against the **existing production Clerk instance** — shared user pool, no second identity system |
| Backend | New **`/api/v1/*` JSON route handlers in the same Next app** — no separate service |
| Admin panel | **Not in the app.** Admin stays web-only, permanently. |
| Analytics | **Extend the existing tables with a `platform` dimension** — do NOT fork the v2 dashboard |
| Downloads | **No DRM** — signed Mux static renditions (free content; see §8) |
| Distribution | App Store + Google Play. **Requires the Mux paid plan** (§13). |

## 2. Framework decision

All three candidates end at the same two engines: **AVPlayer** (iOS) and **ExoPlayer/Media3**
(Android). Nobody ships a decoder. The only question is who maintains the bridge.

| | Native Swift+Kotlin | **Expo / RN (chosen)** | Flutter |
|---|---|---|---|
| PiP | first-party | in `react-native-video` | write a platform channel |
| AirPlay | free with AVPlayer | free (native route picker) | plugin / platform channel |
| Chromecast | Cast SDK | `react-native-google-cast` | community plugins, uneven |
| Offline | `AVAssetDownloadTask` / Media3 `DownloadManager` | supported | largely DIY |
| **Mux Data** | official iOS + Android SDKs | official `@mux/mux-data-react-native-video` | **Mux's own docs say: bridge the native SDKs** |
| **Clerk** | iOS SDK | `@clerk/expo`, 3.x, actively shipped | **beta since 2025-03, ambiguous support status** |
| Shared TS contracts | reimplement ×2 | **imported directly** | reimplement in Dart |
| OTA updates | none | `expo-updates` (JS fixes without review) | 3rd-party (Shorebird) |
| tvOS path | first-class | `react-native-tvos` | **no official support** |
| Relative client effort | ~2.0x | 1.0x | ~1.3x |

**The decisive argument is §3 — code reuse.** `CLAUDE.md` states that `lib/tracked-links.ts`
must stay *byte-identical* to `normalizeUtm` or link stats silently stop matching. Matio has a
family of such contracts. A Dart or Swift+Kotlin mirror of each one is a permanent silent-drift
generator aimed at exactly the analytics this app is supposed to feed.

Flutter's real strengths (pixel-identical rendering, superb custom animation for a vertical
feed) were weighed and lost to: Mux's Flutter story being "bridge it yourself", Clerk Flutter
being beta, zero code sharing, and no tvOS path.

## 3. Repo shape — monorepo

> **REVISED 2026-07-29: deferred, not cancelled.** The restructure is no longer phase 0. Three
> reasons: (a) changing Vercel's Root Directory is production-affecting on a deploy-on-push
> repo, and there is no way to stage it — the setting is global to the project; (b) Expo needs
> `node-linker=hoisted` in a pnpm workspace, which changes the *web's* install semantics, and
> this repo has a documented history of pnpm shared-store corruption; (c) the `/api/v1` layer
> — the single biggest chunk of work — needs none of it. Build the API first, scaffold the app
> second, and make the workspace call with evidence about whether Expo + pnpm behaves here.
> Until then `lib/api/types.ts` is written to universal rules so the move is a file copy.

`pnpm-workspace.yaml` already exists (settings-only — `ignoredBuiltDependencies`, no `packages:`
key), so this is a small change, not a migration.

```
apps/web/          ← the current Next app, moved wholesale
apps/mobile/       ← Expo app
packages/shared/   ← universal TS lifted out of lib/
pnpm-workspace.yaml  ← + packages: ['apps/*', 'packages/*']
```

**Lift into `packages/shared` (all already universal — no `server-only`, no DB imports):**

| Module | Why it must be shared, not copied |
|---|---|
| `lib/utm.ts` + `lib/tracked-links.ts` | byte-identical normalization is a hard invariant |
| `lib/watch-segments.ts` | bucket size must match the server's validator |
| `lib/episode-access.ts` (client half) | the lock rule; a second copy = a paywall bug |
| `lib/i18n/dictionaries.ts` + `negotiate.ts` + `shared.ts` | es/en copy, one source |
| `lib/design.ts` | brand tokens — app and web must not drift |
| `lib/slug.ts`, `lib/seo.ts`, `lib/continue-watching.ts`, `lib/flags.ts` | shared rules |

**Stays web-only:** anything importing `server-only`, `next/*`, drizzle, or `db/`.

> **Vercel gotcha:** moving the Next app to `apps/web` requires changing the project's
> **Root Directory** to `apps/web` in the Vercel dashboard. Ship that as its own commit +
> deploy and verify production before touching anything else. `vercel.json` (`regions: fra1`,
> cache headers) moves with the app.

## 4. `/api/v1` — the backend half (~35% of the project)

Today there are three public route handlers and a wall of server actions. Server actions are
unusable from a native client, so the app needs a real JSON surface.

### 4.1 Auth — simpler than expected

`proxy.ts`'s matcher already includes `"/(api|trpc)(.*)"`, so **`/api/v1/*` runs inside
`clerkMiddleware` and `auth()` works unchanged** — Clerk resolves an `Authorization: Bearer
<session token>` header the same way it resolves the cookie. `@clerk/expo`'s `getToken()`
supplies that token.

- Set **`authorizedParties`** on `clerkMiddleware` before shipping (native clients have no
  `Origin`; this is the CSRF-equivalent guard).
- `applyVisitorCookie` already early-returns on `/api` paths — the app therefore carries its
  own identity as a header (§5), never a cookie.

### 4.2 Endpoints

| Endpoint | Notes |
|---|---|
| `GET /v1/config` | **Build this first.** `paymentsEnabled`, `signupRequired`, **`minSupportedBuild`** (force-upgrade lever), feature flags. |
| `GET /v1/catalog` | reuse `getPublishedShows()` (already `unstable_cache`'d, tag `catalog`) |
| `GET /v1/shows/:slug` | seasons, ready episodes, tiers, cast, artwork, `orientation`, synopsis |
| `GET /v1/actors/:slug` | parity with `/actors/[slug]` |
| `POST /v1/playback-token` | port of `app/api/playback-token/route.ts` — see §4.3 |
| `POST /v1/progress` | `saveWatchProgress` equivalent (+ `watch_days` upsert, monotonic `max_position_seconds`) |
| `GET /v1/continue-watching` | reuse `lib/continue-watching.ts` |
| `POST /v1/watch-segments` | `saveWatchSegments` equivalent; **must keep the ≤120-bucket cap** |
| `POST /v1/visit` | `/api/t` equivalent, keyed on the device id |
| `POST /v1/devices` | register/unregister push tokens |
| `DELETE /v1/devices/:id` | on sign-out |
| `POST /v1/reminders` | `subscribeToShowReminder` equivalent (keep the per-IP rate limit) |
| `POST /v1/account/delete` | **App Store 5.1.1(v) requires in-app deletion** (§11) |

### 4.3 Playback token, ported

The web route is `GET ?episode_id=`, returns `{ token, expiresIn, mode }` with
`mode ∈ subscriber | member | free | trial`, `403 { reason: "signup_required" |
"subscribe_required" }`, `429` + `Retry-After`. Keep that contract verbatim — the client
overlay routing depends on it.

Changes for the app:
- **POST, not GET**, with a JSON body (device id + episode id). It has side effects
  (trial-row minting, wall stamping) and must never be cached by an intermediary.
- The `trial_session` **cookie has no app equivalent** — the anonymous funnel key becomes the
  device id (§5). Note that under `REQUIRE_SIGNUP=1` anonymous playback doesn't exist at all,
  which makes this mostly moot; keep the branch correct anyway for the flag-off case.
- In free mode the logic collapses to: signed-in → `member`, anonymous →
  `free` (or 403 `signup_required` when the gate is on). The `trial`/`subscriber` branches are
  dormant but must be ported intact — the flag can be flipped back.

### 4.4 The permanent constraint

Once v1 ships to a store, **it is backward-compatible forever.** Users sit on old binaries for
months. This is a genuine change from how the web is developed today. `minSupportedBuild` in
`/v1/config` is the only escape hatch — wire it in phase 0, not later.

## 5. Identity & analytics continuity

The v2 dashboard's premise is a single retention number. If the app reports separately, that
number quietly starts meaning two different things.

**Extend, don't fork:**

- **Device id** replaces `matio_aid`: a UUID minted into `expo-secure-store` on first launch,
  sent as `X-Matio-Device-Id` on every `/v1` call. Same role as the cookie, same write-once
  semantics, same consent-exempt legitimate-interests basis (update `/privacy` + `/cookies`
  to describe the app's identifier).
- **Migration (additive):** `platform` enum column (`web | ios | android`, default `web`) on
  `visitors`, `visitor_days`, `watch_days`, `watch_segments`.
- **`linkVisitorToUser` is reused unchanged** for the device→user merge ("склейка"). First
  link wins, same as web.
- **`lib/admin-analytics-v2.ts` gains a platform filter**, not a second dashboard.

**Known asymmetry:** the device id survives reinstall on iOS (keychain-backed) but generally
does not on Android. App "unique visitors" will therefore skew slightly high on Android.
Acceptable; document it next to the existing "ledgers accrue from deploy" caveat.

**Consent model changes shape:** no cookie banner. Instead — an **ATT prompt** on iOS (only
needed if Meta install attribution is wanted, §10) plus an EU consent screen gating PostHog and
Meta app events. `marketingConsentRequired()` ports as-is for the geo decision.

## 6. Player architecture

### 6.1 What dies on native (a large discount)

These exist *purely* as browser scar tissue and have no native equivalent:

- `lib/can-autoplay.ts` and the whole muted-autoplay capability probe
- the muted-fallback start + "Tap for sound" pill + `mediaunmuterequest` handling
- the `loadedmetadata`/`canplay`+2s blocked-play detection probe
- the `mountKey` / `refreshNonce` element-identity dance — that exists *only* because WebKit's
  autoplay blessing is per-`<video>`-element
- `lib/in-app-browser.ts` + `OpenInBrowserHint` — the entire Instagram/Facebook webview
  problem class disappears
- `visibilitychange` save gating → becomes `AppState`, simpler
- cookie consent banner and all cookie plumbing

### 6.2 What ports (and stays fiddly)

- **Token refresh at expiry−60s**, with 1s/2s/4s backoff, keeping the old token playing through
  the refresh window. Same reasoning as web: Mux validates `exp` per segment request.
- **Instant auto-advance** — swap `source` on the same player instance at `ended`. Element
  identity no longer matters, so this is *easier*, but the 45s `PRELOAD_LEAD_SECONDS` prefetch
  of the next token is still wanted.
- **10s-bucket retention telemetry** — now needs an **offline queue** (persist buckets, flush
  when connectivity returns) since mobile networks drop. Keep the ≤120-buckets/flush cap.
- **Three failure overlays** — `Paywall` / `RateLimitedNotice` / `PlaybackUnavailable`, routed
  off the same status codes and `reason` values.
- **Vertical vs horizontal chrome** — `shows.orientation` drives it, same as `useVerticalLayout`.

### 6.3 New on native

PiP, background audio, AirPlay route picker, Chromecast, lock-screen / Control Center now-playing
metadata, and download management.

> A vertical swipe feed needs deliberate **player pooling** (2–3 instances recycled, not one per
> item) with FlashList. This is the one place RN needs more care than Flutter would.

## 7. Push notifications

- `expo-notifications` over APNs (iOS) + FCM (Android). New `push_devices` table:
  `(id, user_id nullable, device_id, expo_push_token, platform, locale, created_at, revoked_at)`.
- **Reuse the existing manual dispatch model.** The admin show-edit "Episode reminders" panel
  gains a push arm alongside Resend: same claim-and-stamp pattern
  (`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`), same un-claim on failed send, same
  invariant that an unstamped row means "still owed a notification". Do not add a scheduler.
- Deep link target: `matio://watch/<slug>?ep=<episodeId>` → Expo Router. Same
  `utm_source=email`-style tagging, with `utm_source=push`.
- Locale per device row, mirroring `show_reminders.locale`.

## 8. Offline downloads

**No DRM.** The content is free; DRM (FairPlay/Widevine) exists to protect paid content and
would add license-server complexity and cost for no benefit here.

- Enable **Mux static renditions** on assets (**requires the paid plan**), fetch via a
  short-TTL signed URL into app-private storage with `expo-file-system`.
- **Signed-URL expiry vs download duration** is the main trap: a large file on a slow connection
  can outlive its token. Issue download URLs with a longer TTL than playback tokens, and support
  resume by re-signing rather than restarting.
- Downloads screen: per-episode state (queued / downloading / ready / expired), storage usage,
  delete-all. Expire local files on a fixed schedule so the library doesn't grow forever.
- Watch progress from offline playback queues locally and syncs on reconnect — same queue as
  the retention buckets (§6.2).

## 9. Casting, PiP, background audio

- **Chromecast:** `react-native-google-cast` (Expo config plugin; requires a dev build). Needs a
  Cast receiver app id and a signed playback URL the receiver can fetch — note the receiver is a
  *separate client* and needs its own token TTL consideration.
- **AirPlay:** essentially free via AVPlayer's native route picker.
- **PiP + background audio:** `react-native-video` props + the iOS `audio` background mode and
  Android foreground-service config.

## 10. Acquisition & install attribution

- **Universal Links / App Links** on `matio.tv` (`apple-app-site-association` +
  `assetlinks.json` served from the Next app) so ad → install → correct show works, and web
  → app handoff works for installed users.
- **Meta install campaigns** need `react-native-fbsdk-next` app events + SKAdNetwork
  configuration. **Trade-off to decide consciously:** app-install attribution requires the ATT
  prompt, and opt-in rates are low — expect materially worse match rates than the web pixel
  currently gets. The existing UTM-cookie attribution model does not transfer; install
  attribution is a separate, coarser system.
- ASO: store listing copy in es/en, screenshots, preview video.

## 11. Store compliance checklist

- [ ] **In-app account deletion** (5.1.1(v)) — Clerk `user.delete()`. Not present on web either.
- [ ] **Sign in with Apple** is required **only if** any third-party social login is offered.
      Clerk email-code only → exempt. Adding "Continue with Google" for mobile convenience
      would drag SIWA in with it. Decide before building the auth screen.
- [ ] Privacy nutrition labels (App Store) + Data Safety form (Play) — must match what the
      device id, PostHog, and Meta SDKs actually collect.
- [ ] ATT prompt if and only if Meta attribution ships (§10).
- [ ] Age rating for the content library.
- [ ] Guideline **4.2 minimum functionality** — a parity build clears this comfortably; a thin
      wrapper would not.
- [ ] Guideline **5.1.1(v) account gating** — if `REQUIRE_SIGNUP=1` applies in-app, expect this
      to be the most likely review friction point (§14).
- [ ] Export compliance (uses HTTPS only → standard exemption).
- [ ] No external payment links anywhere (moot while free, but a trap if payments return).

## 12. Phasing

Each phase is independently shippable; the target is still full parity.

| Phase | Contents |
|---|---|
| **0** | **(started 2026-07-29)** `/api/v1` read surface — `config`, `catalog`, `shows/:slug`. Monorepo deferred per §3 |
| **1** | App shell: `@clerk/expo` auth, catalog, show page, basic player, continue-watching, es/en |
| **2** | **Player parity** (the long pole): auto-advance, retention buckets, vertical feed, PiP, background audio |
| **3** | Push + deep links + universal links + admin dispatch arm |
| **4** | Offline downloads + Chromecast |
| **5** | Analytics parity: `platform` migration + dashboard dimension |
| **6** | Store submission, ATT decision, install campaigns |

TestFlight from the end of phase 1; the store listing can be prepared in parallel from phase 3.

## 13. Prerequisites & blockers

| Item | Blocks | Status |
|---|---|---|
| **Mux paid plan** | phase 4 entirely (static renditions), and the 10-asset cap blocks content growth | **open — hard blocker** |
| Apple Developer Program ($99/yr) | any device testing beyond simulator | open |
| Google Play Console ($25 one-time) | Android release | open |
| **EAS dev builds from day one** | everything — Expo Go cannot load `react-native-video`, Cast, or the Mux Data SDK | n/a, just a workflow rule |
| Expo account + EAS Build | CI | open |
| `authorizedParties` on `clerkMiddleware` | secure `/v1` auth | open |

## 14. Decisions — locked 2026-07-29

### 14.1 The catalog fact that governs everything

Measured against production on 2026-07-29:

| Show | Ready eps | Minutes | Tier | Released |
|---|---|---|---|---|
| QUÉDATE CONMIGO | 3 | 10.7 | subscriber | — |
| THE SCARLET OATH | 2 | 25.0 | member | 2026-07-25 |
| EL CARTERO DEL MUNDO | 1 | 3.3 | subscriber | — |
| JUEGO de SEDUCCIÓN | 1 | 3.4 | subscriber | — |
| Morelli (vertical) | 1 | 4.5 | subscriber | — |
| **Total** | **8** | **~47 min** | | |

**The whole live catalog is 8 episodes and about 47 minutes**, and only one show has ever had a
release date stamped. This does not change whether to build the app, but it does change what the
app can be *judged* on:

- **Push has almost nothing to announce.** The retention thesis needs a release cadence that
  doesn't exist yet.
- **Offline downloads for 47 minutes is not a feature anyone needs.** Reinforces deferring
  phase 4.
- **App Store review is the real exposure.** A 47-minute library behind a login wall is
  squarely in Guideline 4.2/4.3 territory. Engineering does not fix this — content does.

**Conclusion: build phases 0–3, but treat store submission as gated on catalog growth, not on
engineering completeness.** The binding constraint on the entire app thesis is the Mux asset
cap, not the code.

### 14.2 Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Signup gate: soft, `after_episodes: 1`** — NOT the web's hard gate | App Store 5.1.1(v) expects usability before registration; Matio's own Meta Lead remap already says "finished ep 1" is the hooked-viewer moment; the design handoff independently specified a wall "after ~Ep. 2". Delivered via `/v1/config` so it's tunable without a store release. |
| 2 | **Mux paid plan: highest-priority non-engineering action**, ahead of app work | It gates content growth (10-asset cap), which gates the app's entire justification. Blocks phase 4; does not block 0–3. |
| 3 | **Design: reuse the shipped 8a/9a/9b system.** No new design work | The handoff is the *already-implemented* web redesign (live since 2026-07-05). Its 8a mobile screens and 9b vertical player are directly the app's reference; `lib/design.ts` holds the tokens. |
| 4 | **Meta install campaigns + ATT: NO for v1** | Low ATT opt-in, coarse SKAdNetwork data, and paying for installs into a 47-minute library is buying retention the catalog can't honour. Also removes the ATT prompt from v1 and simplifies privacy labels. Revisit after phase 5. |
| 5 | **tvOS / Android TV: not a goal; door kept open at zero cost** | Keep navigation and state out of view components; prefer libraries known to work under `react-native-tvos`. No work now. |
| 6 | **Downloads: no DRM** (confirmed) | Free content; DRM protects paid content and buys nothing here. |
| 7 | **Monorepo restructure: deferred** (see §3) | Production risk + pnpm/Expo uncertainty + the API needs none of it. |

### 14.3 Still genuinely open

- **Mux plan purchase** — a spend decision, not an engineering one.
- **Apple Developer + Google Play enrolment** — needed before any device testing; Apple's
  review of a new developer account can take weeks, so start it early even though it blocks
  nothing until phase 1.
- **`authorizedParties` on `clerkMiddleware`** — deliberately NOT changed yet. Clerk native
  tokens and the `azp` claim interact in a way that could reject app requests if guessed
  wrong, and this repo cannot browser-verify auth locally (prod Clerk drops localhost
  redirects). Do it *with* the app's auth, against a real device.

## 14b. Built so far

**Phase 0, 2026-07-29 — `/api/v1` read surface.** Purely additive; no existing behavior touched.

| File | Purpose |
|---|---|
| `lib/api/types.ts` | Universal wire types + `API_VERSION`. First module to move to `packages/shared`. Documents the forever-backward-compatible contract rule. |
| `lib/api/v1.ts` | Server helpers: `apiOk` / `apiError` (typed codes → status), `readDeviceId` (UUID-validated `X-Matio-Device-Id`), `absoluteMediaUrl`, `envInt`. |
| `app/api/v1/config/route.ts` | Startup call. `minSupportedBuild` force-upgrade lever + flags + resolved `signupGate`. No DB, `force-dynamic`. |
| `app/api/v1/catalog/route.ts` | Published shows + ready-episode counts, one grouped query, `s-maxage=60`. |
| `app/api/v1/shows/[slug]/route.ts` | Show + ordered ready episodes, signed thumbnails, 404 path. |

Verified against the production database via a local dev server: all three endpoints return
correct data, the 404 path returns the typed error body, and thumbnail URLs carry `aud:"t"`
tokens that cannot mint video.

**Bug caught by that smoke test:** legacy artwork rows store *relative* paths
(`/shows/cartero-mundo-poster.png`) which a native client cannot resolve. Fixed with
`absoluteMediaUrl` on every media field crossing the API boundary — a trap for any future
endpoint returning artwork.

**Design note:** `/v1/catalog` and `/v1/shows/:slug` are deliberately **auth-independent** and
return the RAW `episodes.access` tier. Gating is expressed once, in `/v1/config.signupGate`,
and enforced once, in `/v1/playback-token`. This keeps the read endpoints cacheable and avoids
baking a half-designed tier coercion into a permanently backward-compatible contract.

**Phase 1 start, 2026-07-30 — the Expo app scaffold.** `mobile/`, Expo SDK 57 / RN 0.86 /
React 19.2, expo-router with a `src/app` root. See [`mobile/README.md`](../mobile/README.md).

| Area | Decision as built |
|---|---|
| Package manager | **npm inside `mobile/`, outside the pnpm workspace.** Expo needs `node-linker=hoisted` under pnpm, which would change the web's install semantics against a repo with a pnpm-store-corruption history. Two managers, zero coupling. |
| Shared code | `src/shared/design.ts` and `src/shared/api-types.ts` re-export `../../../lib/*`. The only two files holding a cross-boundary path; everything else imports `@/shared/...`. |
| Metro | `watchFolders: [../lib]` so those resolve, plus `resolver.disableHierarchicalLookup = true` — without it Metro walks up and bundles the **web app's** React as a second copy. |
| Isolation | root `tsconfig.json` excludes `mobile`; eslint ignores `mobile/**` (the app has its own toolchain). `design_handoff_matio_redesign/**` was also added to the eslint ignores, which cleared 2 pre-existing lint errors. |
| Design tokens | `lib/design.ts` extended additively with `PALETTE`, `INK_MUTED`, `INK_DIM`, and `TONE_STOPS`. `TONE_GRADIENT` is now **derived** from `TONE_STOPS` (byte-identical output) so the RN colour-stop arrays and the CSS gradient strings can't drift. |
| Screens | `index.tsx` (hero + Just released / Popular now / All shows rails), `show/[slug].tsx` (hero, synopsis, episode cards with signed thumbnails). |

Verified: both typechecks clean, web lint clean, Metro produced a 5.67 MB iOS bundle containing
the shared tokens, and the app rendered **live API data** on an iPhone 16 Pro simulator (correct
show, artwork, brand palette).

**Phase 1 continued, 2026-07-30 — gate enforcement + brand fidelity.**

- **`POST /api/v1/playback-token`** — the app's only Mux-JWT mint. Native twin of the web route
  with three forced differences: POST (side effects, never cacheable); the anonymous identity is
  the **device-id header** taking `trial_sessions.session_token`'s slot, since proxy.ts skips
  `/api` for cookies; and the **positional** signup gate. The legacy 60s trial, subscriber, and
  tier branches are all ported intact for a payments re-enable.
- **`resolveSignupGate()` now lives in `lib/api/v1.ts`** and is called by BOTH `/v1/config` (which
  *describes* the rule to the client) and `/v1/playback-token` (which *enforces* it). This is
  deliberate: the free-pivot bug was a client and server disagreeing about gating, and
  `after_episodes: N` is now impossible to implement twice.
- **Gate semantics**: `after_episodes: N` = the first N ready episodes **of each show** are open
  to anonymous viewers, positional against `getOrderedReadyEpisodeIds` so "episode 2" means the
  same thing in the app as in the web funnel.
- **Client locks prop-driven** via `isEpisodeLockedForApp()` in `lib/api/types.ts` (universal,
  shared) — the app never learns an episode is locked from a 403.
- Dependencies **approved and added**: `expo-linear-gradient`, `@expo-google-fonts/anton`,
  `geist`, `geist-mono`. Scrims, the duotone wash, the tone fallbacks and the gold CTA are now
  real gradients; Anton/Geist/Geist Mono are loaded in `_layout.tsx` behind the splash.
- **`ConfigProvider`** fetches `/v1/config` at launch and hard-blocks when `APP_BUILD`
  (`src/build.ts`, bump per release) falls below `minSupportedBuild`.

Verified against the live API on an iPhone 16 Pro dev build:

| Case | Result |
|---|---|
| ep 1, gate on | `200 mode=free` |
| ep 2, gate on | `403 signup_required` |
| ep 2, gate **off** (control) | `200 mode=free` — proves the gate is the cause |
| malformed / unknown / empty id | `400` / `404` / `400` |
| UI under gate | ep 1 plays, ep 2 dimmed with a gold "Free account" label |

**Gotcha found:** the 8a spec's `line-height: 0.98–1.0` is a *CSS* ratio where oversized glyphs
overflow. **React Native clips text to lineHeight**, so Anton's ascenders were shaved off the
hero title until it was raised to ~1.1.

**Phase 1 complete, 2026-07-30 — auth + player.** Deps added: `@clerk/expo`, `expo-secure-store`,
`expo-crypto`, `react-native-video`.

- **Device identity** (`src/api/device.ts`): UUID in SecureStore, sent as `X-Matio-Device-Id`.
  Write-once, never refreshed — same semantics and legal basis as the web's `matio_aid`.
- **Auth** (`src/auth/clerk.tsx`): `ClerkProvider` against the SAME production Clerk instance —
  one user pool, no second identity system. Passwordless **email code**, which is already the
  canonical credential for guest-checkout accounts. `AuthBridge` injects Clerk's `getToken` into
  the plain fetch client. A missing publishable key runs **signed-out rather than crashing** —
  the catalog is readable signed-out, so a misconfigured build should still browse.
- **Player** (`src/app/watch/[episodeId].tsx`): `react-native-video` on
  `https://stream.mux.com/<playbackId>.m3u8?token=<jwt>`, with the web's three distinct end
  states preserved — `SignupWall` (403 signup_required), paywall (403 subscribe_required),
  rate-limited (429), unavailable (everything else, incl. a `<Video>` decode error, which is
  tracked separately from a token failure).

Verified on the simulator against the live API: ep 1 → token `200 mode=free` → **video plays**;
ep 2 → `403 signup_required` → **sign-up wall renders**.

**Bug found and fixed — infinite spinner.** `buildHeaders()` awaits the keychain and Clerk's
`getToken()`, and **`getToken()` can hang rather than reject** when the Clerk client hasn't
finished loading. The request deadline only started at `fetch()`, and an awaited hung promise is
not abortable, so the player sat on a spinner forever while **zero** requests reached the server.
`/v1/config` masked it by being fetched before `AuthBridge`'s effect installed the provider. Both
pre-flight lookups now have their own 3s deadline and degrade to anonymous.

**Build gotchas** (both cost a full rebuild cycle):
1. Adding native modules to an existing generated `ios/` fails `pod install` with
   `undefined method 'package_product_dependencies' for nil` in RN's SPM script. Fix: delete
   `ios/` and `expo prebuild --clean`. Incremental prebuild is not reliable here.
2. `@clerk/expo`'s config plugin adds a **Sign in with Apple entitlement by default**, which
   forces a code-signed build and breaks simulator builds with "No code signing certificates".
   Matio offers no third-party login — which is exactly what makes it **exempt from App Store
   guideline 4.8** — so the entitlement is both unnecessary and misleading. Disabled with
   `["@clerk/expo", { "appleSignIn": false }]` in `app.json`.

**Not yet done in the player** (deliberate, next phase): token refresh at expiry−60s (episodes
are 9–16 min against a 1h TTL, so nothing can currently expire mid-playback), auto-advance,
watch-progress saves, 10s retention buckets, PiP/cast/offline.

**Untested by design:** no real sign-up was completed — the key is `pk_live_…`, so that would
create a real user in the production Clerk instance. The email-code flow is built and typechecks
against the SDK's actual surface, but the round trip is the owner's to run. The tracking-write
path (`trial_sessions` mint) was likewise exercised only without a device-id header, to avoid
writing test rows into the production analytics ledger.

**Environment gotchas discovered** (both recorded in `mobile/README.md`): macOS **Automation
(TCC) permission is denied** for this shell, so `expo start --ios` crashes when the CLI tries to
activate the Simulator window (`osascript … System Events … non-zero code: 1`) — run
`npx expo start` and `xcrun simctl openurl booted exp://127.0.0.1:8081` instead. And Expo Go's
first-run dev-menu sheet covers the lower half of the screen while needing a real tap to
dismiss, which `simctl` cannot do — a native dev build avoids it.

## 15. Traps

- **`/api/v1` is inside the Clerk matcher already** — don't add a second auth layer. Do add
  `authorizedParties`.
- **Never reuse `/api/playback-token` directly from the app.** It is cookie-shaped
  (`trial_session`, `matio_aid`) and its GET semantics are wrong for a side-effecting call.
- **Don't copy shared logic into the app.** Anything duplicated from `lib/` drifts, and the
  UTM/bucket/lock rules are exactly the ones that fail silently when they do.
- **Don't fork the analytics dashboard.** A `platform` column keeps one retention number;
  a second dashboard means the North-Star metric quietly measures only web.
- **Don't add `paymentsEnabled()` branches to the app's webhook-adjacent paths** — the same
  rule as web. The flag belongs at access gates and payment surfaces only.
- **Expo Go is a dead end here.** Every phase-2 dependency needs native code.
- **Vercel root-directory change is a production-affecting deploy.** Ship it alone.
