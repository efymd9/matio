# Gotchas

Version-specific traps and surprises that bit us during the build. Read this **before** touching any of the integrations — your training data is probably wrong on at least one of these. See also [services](./services.md) for setup, [architecture](./architecture.md) for why decisions were made.

## Next.js 16

### proxy.ts, not middleware.ts

Next 16 deprecated the `middleware.ts` file convention in favor of `proxy.ts`. The Clerk function name (`clerkMiddleware`) is unchanged — only the file name. Dev server logs a deprecation warning if you use `middleware.ts`. Per-request execution profile: `proxy.ts` runs on Node by default (vs the old Edge-only middleware).

### async `params` and `searchParams`

Dynamic-route props are Promises in Next 15+:

```ts
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ resume?: string }>;
}) {
  const { slug } = await params;
  const { resume } = await searchParams;
  ...
}
```

### Cookie rules

- Server Components can **read** cookies via `cookies()` from `next/headers`.
- Server Components **cannot set** cookies.
- To set on first request: do it in `proxy.ts` (`response.cookies.set(...)` on `NextResponse.next()`), in a Route Handler, or in a Server Action (these all return responses that the runtime applies cookies on).

This is why `trial_session` is issued by proxy.ts, not by the watch page.

### tsconfig `jsx` flips on first build

Next 16 mandates `jsx: react-jsx` and silently rewrites tsconfig on first build. Don't fight it — commit the change.

### Route groups don't affect URLs

`app/(public)/page.tsx` and `app/page.tsx` both resolve to `/`. The `(group)` is purely organizational — sharing a layout or signaling intent. Having both = build error.

## React 19 hooks rules

`eslint-config-next@16` ships `eslint-plugin-react-hooks@5+`, which adds two rules that flag patterns that were idiomatic in React 18 and earlier. Both fail the Vercel build by default (Next runs ESLint during `next build`).

### `react-hooks/set-state-in-effect` — no synchronous setState in an effect body

This fails:
```ts
useEffect(() => {
  setX(initial);   // ← flagged: cascading render
  doAsync().then((v) => setX(v));
}, [dep]);
```

The reset is treated as "synchronous setState in an effect body" — React 19 wants the body of an effect to either sync with an external system or call setState only from a callback (event handler, fetch resolver, etc.). The classic "reset state when a prop changes" use case has to be expressed a different way.

Three fixes, in order of preference:

1. **Key-based remount on a child component.** Lift the resettable state into a child and pass a `key` that changes when you want the reset. Mount/unmount handles the reset, no setState-in-effect needed. This is what `components/watch/player.tsx` does — outer `Player` owns selection state, inner `EpisodePlayback` is `key={current.id}` and owns per-episode state.

2. **Move setState into a callback.** If the value is fetched, set it only inside the `.then()`/`onSuccess` — the rule fires on synchronous-in-body, not on callbacks.

3. **Derive state from props during render.** If the "state" is actually a function of props, drop it from state entirely and compute during render or via `useMemo`.

### Refs during render

```ts
if (paywall) {
  const lastPos = lastSavedRef.current;   // ← flagged
  return <Paywall resumeSeconds={lastPos} />;
}
```

Reading (or writing) `ref.current` during render breaks React 19's component-update invariant. Fix: keep the ref for fast access inside callbacks (intervals, event handlers, effects), but mirror the value to state for anything render needs. `EpisodePlayback` does both — `lastSavedRef` is used inside the 10s save interval (allowed), `lastSaved` state is what the paywall branch reads.

### `useSyncExternalStore` for SSR-safe "client only" flags

The setMounted pattern is flagged by `set-state-in-effect`:
```ts
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);   // ← flagged
```

Replace with `useSyncExternalStore`, which has a separate server snapshot:
```ts
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const mounted = useSyncExternalStore(
  subscribe,
  getClientSnapshot,
  getServerSnapshot,
);
```

Both `EpisodesOverlay` and `UpNextOverlay` use this for their portal-target check (`document.body` doesn't exist during SSR).

## Clerk 7 changes

### `<Show>` replaced `<SignedIn>` / `<SignedOut>`

The old conditional render components are gone. Use:
```tsx
import { Show } from "@clerk/nextjs";

<Show when="signed-in">  <UserButton />  </Show>
<Show when="signed-out"> <SignInButton /> </Show>
```
`Show` is an async server component.

### `verifyWebhook` from `/webhooks`

```ts
import { verifyWebhook } from "@clerk/nextjs/webhooks";   // not /server
const evt = await verifyWebhook(req);                     // throws on bad sig
```

Picks up `CLERK_WEBHOOK_SIGNING_SECRET` automatically. Request type is `NextRequest` (not plain `Request`) — `RequestLike` from Clerk needs the Next-specific `cookies`/`nextUrl`/`page` props.

### `redirectToSignIn({ returnBackUrl })`

Param is `returnBackUrl`, not `returnUrl`. Clerk preserves the original URL and pushes the user back after auth.

### Keyless mode is local-only

If `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is empty in dev, Clerk auto-creates a "keyless" instance and writes its keys to `.clerk/.tmp/keyless.json`. Convenient for local dev but **fails in production** with `Missing publishableKey`.

### user.created webhook race

Clerk fires `user.created` asynchronously after signup completes. There's a window — typically tens to hundreds of milliseconds — where Clerk thinks the user is signed in but our `users` mirror hasn't been written yet. Anything that does a `users` lookup keyed on the Clerk userId can crash in that window.

The classic example: a fresh signup goes straight from Clerk's hosted signup → `/subscribe` → clicks Subscribe → `startCheckout` looks up the `users` row and throws "Local user row missing" before the webhook has landed.

Fix: anywhere a missing mirror would block the flow, use `getOrSyncCurrentUser()` from `lib/admin.ts` instead of a raw query. It reads the row, and if it's missing, upserts from Clerk's `currentUser()` (idempotent with the webhook via `onConflictDoNothing`).

## Stripe API 2024+ moves

These three field moves caused real bugs during build:

### `subscription.current_period_end` → `subscription.items.data[].current_period_end`

Per-item subscription periods. Read it from the line item, not the subscription root.

```ts
const periodEnd = sub.items.data[0]?.current_period_end;
```

### `invoice.subscription` → `invoice.parent.subscription_details.subscription`

The Invoice → Subscription pointer is now nested under `parent`. Top-level `invoice.subscription` doesn't exist in SDK 22+.

```ts
const ref = invoice.parent?.subscription_details?.subscription;
const subId = typeof ref === "string" ? ref : ref?.id;
```

### Cancel: `cancel_at_period_end` vs `cancel_at`

The Customer Portal sets `subscription.cancel_at` (a unix timestamp) when you cancel "at period end" — NOT the legacy `subscription.cancel_at_period_end: true` boolean. If you only mirror the boolean, cancellations silently disappear.

The webhook OR's them:
```ts
const cancelScheduled = sub.cancel_at_period_end || sub.cancel_at != null;
```

### Status enum is wider than ours

Stripe's `Subscription.Status` includes `incomplete`, `incomplete_expired`, `paused`, `unpaid`. Our DB enum is `active | past_due | canceled | trialing`. The map in `app/api/webhooks/stripe/route.ts`:
- `active` → `active`
- `trialing` → `trialing`
- `past_due`, `unpaid` → `past_due`
- everything else → `canceled` (safer than granting access)

## Mux SDK 14+

### Webhook unwrap is async

```ts
const evt = await mux.webhooks.unwrap(body, req.headers, signingSecret);
```
`unwrap` does signature verification + parse in one step. Returns a discriminated union of `UnwrapWebhookEvent` subtypes; narrow with `evt.type`.

### `playback_policies` (plural array)

Direct uploads:
```ts
mux.video.uploads.create({
  cors_origin: "*",
  new_asset_settings: {
    playback_policies: ["signed"],     // plural array, not playback_policy: "..."
    passthrough: episode.id,
  },
});
```

`passthrough` goes inside `new_asset_settings` — not at the top level. Mux echoes it back in every webhook event for the resulting asset.

### `VideoAssetReadyWebhookEvent.Data` shape

```ts
{
  id: string,                              // asset id (mux_asset_id)
  playback_ids: [{ id, policy }, ...],     // pick [0].id for mux_playback_id
  duration: number,                        // seconds (float)
  passthrough?: string,                    // our episode id
  status: "preparing" | "ready" | "errored",
  ...
}
```

### Public vs Signed playback IDs

A playback ID with `policy: "public"` plays without a JWT. The Mux Player just ignores `tokens={{ playback }}`. This means:
- If you switch new uploads to `["signed"]` but existing assets stay public, the existing assets bypass your gate.
- To migrate: re-upload, or use the Mux API to add a signed playback ID to existing assets, then store that one.

### Mux client-side buffer behavior

mux-video buffers HLS chunks ahead of the playhead. Token authorization happens **per-segment-request**, so chunks already in the buffer continue to play even after the token expires. This is why `components/watch/player.tsx` runs a `setTimeout(expiresAt - now)` and calls `videoRef.current.pause()` — without that, trial videos run several minutes past the 60s cutoff.

### We use mux-video (headless) for the main player

The main watch surface uses `@mux/mux-video-react` + `media-chrome` (custom React-styled chrome). `@mux/mux-player-react` is retained only for the auto-playing hero preview on `/`. Don't reach for `MuxPlayer` when extending the watch player — its theme system fights anything more involved than color tweaks. Add primitives from `media-chrome/react` or `media-chrome/react/menu` instead.

### Signed playback JWT shape (`lib/mux-token.ts`)

```ts
jwt.sign(
  {
    sub: playbackId,         // the signed playback ID
    aud: "v",                // "v" video, "t" thumbnail, "s" storyboard, "gif" animated gif
    exp: now + ttlSeconds,
  },
  privateKeyPem,
  { algorithm: "RS256", keyid: process.env.MUX_SIGNING_KEY_ID }
);
```

Private key stored base64-encoded to dodge multi-line-PEM-in-env nightmares.

## media-chrome

The watch player is built on `media-chrome` primitives. A few quirks worth knowing in advance:

### Menu components live at `media-chrome/react/menu`

The top-level `media-chrome/react` doesn't export the menu set. Reaching for `MediaRenditionMenu` / `MediaRenditionMenuButton` / `MediaSettingsMenu` from `media-chrome/react` will throw a TypeScript error.

```ts
import { MediaController, MediaPlayButton } from "media-chrome/react";
import { MediaRenditionMenu, MediaRenditionMenuButton } from "media-chrome/react/menu";
```

### React bindings camelCase certain HTML attributes

The HTML attribute is `seekoffset`, but the React binding takes `seekOffset`. TypeScript catches this — if you see `Property 'seekoffset' does not exist`, rename to `seekOffset`.

### Overlays inside `<MediaController>` get treated as gestures

`<media-controller>` captures clicks inside its subtree as media gestures (toggle play/pause). Buttons inside overlays — especially ones positioned absolutely — can fire React's `onClick` but also be intercepted, so e.g. a close button silently fails to close.

Fix: portal overlays out via `createPortal(<dialog />, document.body)`. `EpisodesOverlay` and `UpNextOverlay` both do this. Defense-in-depth: `stopPropagation` on every overlay button's click.

### Chrome visibility uses `[media-ui-inactive]` attribute

media-chrome adds/removes `media-ui-inactive` on the controller as the user idles. Target with Tailwind: `group-[[media-ui-inactive]]/player:opacity-0` on each chrome layer.

### Menus pinned manually beat anchor-positioning

`<MediaRenditionMenu anchor="auto">` would position relative to its trigger button via CSS anchor positioning. On the main player this got clipped against the controller's `aspect-ratio` box. We override with absolute positioning (`!absolute !right-5 !bottom-[92px] z-30`) so the menu always pops over the bottom bar. The button → menu invoker wiring still works.

### Aspect ratio is detected client-side, not server-side

The Player reads `videoWidth / videoHeight` off the `<video>` on `loadedmetadata` and applies it as the controller's `aspectRatio`. Defaults to 16:9 until the manifest is parsed — there's a brief (~200ms) layout flash on first paint where a portrait video renders as 16:9 before correcting to 9:16. Reset on episode swap so a 16:9 → 9:16 transition doesn't briefly render at the wrong ratio. Server-side detection (storing Mux's reported `aspect_ratio` in the DB) would remove the flash; deferred until it matters.

## iOS Safari

The custom player needs two iOS-specific concessions:

### `playsInline` is required on `<MuxVideo>`

Without it, iOS Safari auto-promotes inline video into the system player on first tap, drawing native chrome over ours. Set `playsInline` on `<MuxVideo>` (or any `<video>`) to keep playback in the page surface so our media-chrome layer owns the UI. Fullscreen still hands off to iOS's system player on demand — which is the desired behavior.

### `::-webkit-media-controls-panel` is on the touch hit-test path — don't hide it

WebKit has a media-controls shadow tree with pseudo-elements. Hiding `::-webkit-media-controls` or `::-webkit-media-controls-panel` on iOS Safari turns out to break scrubbing — our `<MediaTimeRange>` visually responds to drags, but the underlying `<video>` never actually seeks. The panel is on iOS's touch-routing path for the media element even when the page renders custom controls over it.

Only safe pseudo-elements to hide for an inline cinema-style overlay:

```css
mux-video::-webkit-media-controls-start-playback-button,
mux-video::-webkit-media-controls-overlay-play-button,
video::-webkit-media-controls-start-playback-button,
video::-webkit-media-controls-overlay-play-button {
  display: none !important;
  -webkit-appearance: none;
}
```

That kills the big "tap to play" disc that overlays inline iOS video. Leave the rest of the WebKit pseudo set alone.

## shadcn (current generation)

### Base UI, not Radix

Newer shadcn templates use `@base-ui/react` instead of `@radix-ui/react-*`. Most components compose the same way, but **`Button` has no `asChild` prop**.

To render a Link styled as a button:
```tsx
import { buttonVariants } from "@/components/ui/button";

<Link href="/x" className={buttonVariants({ variant: "outline", size: "sm" })}>
  Edit
</Link>
```

`asChild` is dead — searching for it across the codebase should return zero results.

### Tailwind v4 (CSS-based config)

No `tailwind.config.{js,ts}`. Theme + color tokens live in `app/globals.css` under `@theme inline { ... }`. `@import "tailwindcss";` at the top of the CSS file.

## Drizzle 0.45

### Multi-column conflict targets

```ts
.onConflictDoUpdate({
  target: [watchProgress.userId, watchProgress.episodeId],
  set: { positionSeconds, completed, updatedAt: new Date() },
});
```

### `defaultRandom()` and `$onUpdate`

```ts
id: uuid("id").primaryKey().defaultRandom(),                   // gen_random_uuid()
updatedAt: timestamp("...").notNull().defaultNow().$onUpdate(() => new Date()),
```
`$onUpdate` is an ORM-level hook — fires on Drizzle `db.update()`. Raw SQL bypasses it. No DB trigger.

### Schema reload after editing

After editing `db/schema/*.ts`, run `pnpm db:generate` — it writes a migration AND a JSON snapshot under `drizzle/meta/`. Forgetting `db:generate` means subsequent `db:migrate` doesn't see your changes.

## TypeScript / build

### Stale `.next/types/validator.ts`

When you move or delete a route, `.next/types/validator.ts` can reference the deleted route by path, causing typecheck errors:
```
Cannot find module '../../app/foo/page.js'
```
Fix: `rm -rf .next && pnpm typecheck`.

### tsx static-import hoisting

This **doesn't work**:
```ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/db";        // hoisted — runs BEFORE config()
```
The static `import` hoists above the call to `config()`. By the time `db/index.ts` reads `process.env.DATABASE_URL`, it's still undefined.

Fix: dynamic import inside `main()`:
```ts
async function main() {
  const { db } = await import("@/db");
  ...
}
main().catch((err) => { console.error(err); process.exit(1); });
```

Or use `tsx --env-file=.env.local script.ts` — Node loads env before the script runs, so static imports work.

### Top-level await in `.ts` scripts

Plain `.ts` scripts run by `tsx` are CommonJS by default. CJS doesn't allow top-level await. Wrap in `async function main()` instead.

## Misc

### Empty `dotenv` log noise

`dotenv@17+` prints `◇ injected env (N) from .env.local // tip:…` lines by default in scripts. Not an error — just visual noise. Suppress with `quiet: true` in the config call if it bothers you.

### Vercel `vercel env add` is single-environment

```bash
vercel env add NAME production preview development   # ❌ "Invalid number of arguments"
```
One environment per call. For preview environments, you also need a git branch as the next arg. Skip preview env vars until git integration is wired (currently not wired — the Vercel account can't see the GitHub `efymd9` repo).

### Public assets bypass the trial gate

Reiterating because it's the highest-impact gotcha: existing Mux assets uploaded before the policy switch have `playback_policies: ["public"]`. Mux Player ignores tokens for public IDs — the trial overlay won't kick in for those videos. New uploads use `["signed"]`. Re-upload anything you want to actually gate.
