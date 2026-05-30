# PostHog Funnel Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consent-gated PostHog (EU Cloud) funnel analytics so we can see exactly where the ads funnel leaks — curated funnel events + pageviews (autocapture off), masked session replay + heatmaps, and a reliable server-side `subscribe_succeeded` conversion fired from the Stripe webhook.

**Architecture:** Mirror the existing consent-gated Meta Pixel pattern. A dynamically-imported `posthog-js` is initialized **only after `cookie_consent.marketing`** in a single provider; call sites fire named events through a thin `window.posthog`-based wrapper (no `posthog-js` in their bundles). The bottom-of-funnel conversion is captured server-side via `posthog-node` inside the Stripe webhook's existing `becameAccessGranting` transition guard. A Next.js rewrite proxies ingestion through `/ingest`. Additive to Meta Pixel/CAPI; nothing existing is removed.

**Tech Stack:** Next.js 16 App Router, TypeScript, `posthog-js`, `posthog-node`, Clerk 7, Stripe 22, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-30-posthog-funnel-analytics-design.md`

**Testing convention:** This repo has **no test framework** (confirmed: no vitest/jest config, zero test files). Per the spec decision, verification uses `pnpm typecheck`, `pnpm lint`, `pnpm build`, and the manual browser checklist in Task 11. Do **not** add a test runner.

**Branch:** Work happens on `feat/posthog-funnel-analytics` (already created; the spec commit is its first commit).

---

## File structure

**New files**
- `lib/posthog-events.ts` — client event wrapper (`capturePostHog`, `onPostHogReady`, event-name type, `window.posthog` typing). No `posthog-js` import → stays out of call-site bundles.
- `lib/posthog-server.ts` — server `posthog-node` client; best-effort, never throws, no-op when unconfigured.
- `components/site/posthog-provider.tsx` — consent-gated init (dynamic `import("posthog-js")`), Clerk identify, manual `$pageview`.
- `docs/posthog-funnel.md` — PostHog account/project setup + saved-funnel/dashboard recipe.

**Modified files**
- `next.config.ts` — `rewrites()` + `skipTrailingSlashRedirect`.
- `proxy.ts` — matcher excludes `/ingest`.
- `app/layout.tsx` — mount `<PostHogProvider initialConsent={…}/>`.
- `components/watch/player.tsx` — `trial_play_started`.
- `components/site/view-content-pixel.tsx` — `show_viewed`.
- `components/site/complete-registration-pixel.tsx` — `signup_completed`.
- `app/subscribe/submit-button.tsx` — `checkout_started`.
- `components/watch/paywall.tsx` — `paywall_shown` + `signup_cta_clicked`.
- `app/api/webhooks/stripe/route.ts` — server `subscribe_succeeded`.
- `app/(public)/cookies/…`, `app/(public)/privacy/…` — PostHog sub-processor disclosure.
- `CLAUDE.md`, `docs/architecture.md`, `docs/services.md`, `docs/gotchas.md` — docs.
- `package.json` / lockfile — `posthog-js`, `posthog-node`.

---

## Task 1: Install dependencies + declare env vars

**Files:**
- Modify: `package.json` (via pnpm)
- Modify: `.env.local` / `.env` (local only — never commit secrets)

- [ ] **Step 1: Install the two PostHog SDKs**

Run:
```bash
pnpm add posthog-js posthog-node
```
Expected: `package.json` gains `posthog-js` and `posthog-node` under `dependencies`; lockfile updates.

- [ ] **Step 2: Add local env vars**

Add to `.env.local` (create if missing — this file is gitignored). Use your PostHog EU project's **Project API Key** (starts `phc_`):
```bash
NEXT_PUBLIC_POSTHOG_KEY=phc_xxx
NEXT_PUBLIC_POSTHOG_HOST=/ingest
POSTHOG_HOST=https://eu.i.posthog.com
```
> If you don't have a PostHog project yet, you can leave these unset for now — every new module no-ops without the key. Set them before the Task 11 manual verification.

- [ ] **Step 3: Verify the install**

Run: `pnpm typecheck`
Expected: PASS (no usages yet; this just confirms the install didn't break types).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add posthog-js + posthog-node"
```

---

## Task 2: Reverse proxy (next.config + matcher)

**Files:**
- Modify: `next.config.ts`
- Modify: `proxy.ts:147`

- [ ] **Step 1: Add rewrites + skipTrailingSlashRedirect to next.config.ts**

Replace the whole `nextConfig` object so it reads:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PostHog recommends posting analytics through a same-origin path so ad
  // blockers don't drop ingestion and the SDK's cookies stay first-party.
  // Middleware (proxy.ts) runs BEFORE these rewrites, so /ingest is excluded
  // from the proxy matcher (see proxy.ts) to skip Clerk auth on every beacon.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
  images: {
    // Mux image service hosts every poster + thumbnail. Anything not
    // listed here falls through to raw <img>.
    remotePatterns: [{ protocol: "https", hostname: "image.mux.com" }],
  },
  experimental: {
    // Tree-shake barrel imports so importing one symbol from these
    // packages doesn't drag the whole module graph into the client bundle.
    optimizePackageImports: [
      "@clerk/nextjs",
      "@base-ui/react",
      "lucide-react",
      "media-chrome",
    ],
  },
};

export default nextConfig;
```

- [ ] **Step 2: Exclude /ingest from the proxy matcher**

In `proxy.ts`, the first matcher entry (line ~147) currently begins `"/((?!_next|[^?]*\\.…`. Add `ingest|` right after `_next|`:
```ts
export const config = {
  matcher: [
    "/((?!_next|ingest|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```
(`/ingest` is not under `/api`, so the second matcher does not catch it.)

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts proxy.ts
git commit -m "feat(analytics): proxy PostHog ingestion through /ingest, skip auth on it"
```

---

## Task 3: Client event wrapper (`lib/posthog-events.ts`)

**Files:**
- Create: `lib/posthog-events.ts`

- [ ] **Step 1: Write the wrapper**

This mirrors `lib/meta-pixel-events.ts`: it talks to `window.posthog` (set by the provider in Task 4) so importing it does **not** pull `posthog-js` into a call site's bundle. Events fired before init are no-ops; `onPostHogReady` defers mount-time events until the consent-gated SDK has loaded (and never fires them without consent).

```ts
// Client-side PostHog helpers. Safe to import anywhere: every capture call is
// a no-op until the consent-gated provider (components/site/posthog-provider.tsx)
// has dynamically loaded posthog-js and assigned window.posthog. That keeps the
// marketing-consent gate in ONE place — call sites just call capturePostHog()
// without re-checking consent. We deliberately do NOT import posthog-js here so
// the SDK stays out of every call site's bundle (it loads once, in the provider).

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "/ingest";

// Dispatched by the provider once posthog-js has finished loading + init.
// Mirrors meta-pixel's PIXEL_READY_EVENT so mount-time events (paywall_shown,
// show_viewed, signup_completed) don't fire into a not-yet-loaded SDK.
export const POSTHOG_READY_EVENT = "matio:ph-ready";

// Curated funnel events. Page-level steps (/, /shows/*, /subscribe) come from
// $pageview path filters, not named events.
export type FunnelEvent =
  | "show_viewed"
  | "trial_play_started"
  | "paywall_shown"
  | "signup_cta_clicked"
  | "signup_completed"
  | "checkout_started";

// Minimal surface we use. The provider assigns the real posthog-js instance
// (which is structurally compatible) to window.posthog after init.
type PostHogClient = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  reset: () => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
};

declare global {
  interface Window {
    posthog?: PostHogClient;
    __phReady?: boolean;
  }
}

export function capturePostHog(
  event: FunnelEvent,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  window.posthog?.capture(event, properties);
}

// Run `cb` as soon as PostHog is loaded. Fires immediately if it already is;
// otherwise waits for POSTHOG_READY_EVENT. If PostHog never loads (no marketing
// consent) `cb` never runs — the desired behaviour for consent-respecting
// mount events. Returns a cleanup that detaches the listener.
export function onPostHogReady(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (window.__phReady === true) {
    cb();
    return () => {};
  }
  const handler = () => cb();
  window.addEventListener(POSTHOG_READY_EVENT, handler, { once: true });
  return () => window.removeEventListener(POSTHOG_READY_EVENT, handler);
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/posthog-events.ts
git commit -m "feat(analytics): client PostHog event wrapper (consent-gated, no-op until loaded)"
```

---

## Task 4: Consent-gated provider (`components/site/posthog-provider.tsx`)

**Files:**
- Create: `components/site/posthog-provider.tsx`

- [ ] **Step 1: Write the provider**

Closely mirrors `components/site/meta-pixel.tsx`. Dynamically imports `posthog-js` only after marketing consent; fires the first `$pageview` from the `loaded` callback and subsequent ones on route change; identifies the Clerk user; opts out + resets on consent withdrawal.

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  CONSENT_CHANGED_EVENT,
  readConsentFromDocument,
  type ConsentRecord,
} from "@/lib/cookie-consent";
import {
  POSTHOG_HOST,
  POSTHOG_KEY,
  POSTHOG_READY_EVENT,
} from "@/lib/posthog-events";

// Consent-gated PostHog loader. posthog-js is dynamically imported ONLY after
// the visitor accepts marketing cookies (same gate proxy.ts uses for
// attribution writes and meta-pixel.tsx uses for fbevents.js). The dynamic
// import also keeps the SDK out of the initial bundle for everyone — it loads
// at most once, after consent. Mounted once in app/layout.tsx next to
// <MetaPixel/>, sharing the same server-parsed initialConsent so an
// already-consented returning visitor is tracked on first paint.
export function PostHogProvider({
  initialConsent,
}: {
  initialConsent: ConsentRecord | null;
}) {
  const pathname = usePathname();
  const { isSignedIn, userId } = useAuth();
  const { user } = useUser();

  const [enabled, setEnabled] = useState(initialConsent?.marketing === true);
  const [ready, setReady] = useState(false);
  const consentRef = useRef(initialConsent?.marketing === true);
  const initializedRef = useRef(false);
  const lastPathRef = useRef<string | null>(null);
  const identifiedRef = useRef<string | null>(null);

  // React to a consent decision after load — no reload needed.
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ marketing?: boolean }>).detail;
      const marketing =
        detail?.marketing ?? readConsentFromDocument()?.marketing === true;
      consentRef.current = marketing;
      if (marketing) {
        // Resume if revoked earlier this session (no-op before init).
        window.posthog?.opt_in_capturing();
        setEnabled(true);
      } else {
        // Withdrawn after load: stop capturing + drop the identified person.
        window.posthog?.opt_out_capturing();
        window.posthog?.reset();
      }
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
  }, []);

  // Initialize posthog-js exactly once, after consent. Dynamic import so the
  // SDK is never in the bundle for non-consenting visitors.
  useEffect(() => {
    if (!enabled || initializedRef.current || !POSTHOG_KEY) return;
    initializedRef.current = true;
    void import("posthog-js").then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        ui_host: "https://eu.posthog.com",
        person_profiles: "identified_only",
        autocapture: false,
        capture_pageview: false, // fired manually below for App-Router routes
        capture_pageleave: true,
        enable_heatmaps: true,
        disable_session_recording: false,
        session_recording: { maskAllInputs: true, maskTextSelector: "*" },
        loaded: (ph) => {
          window.posthog = ph as unknown as Window["posthog"];
          window.__phReady = true;
          lastPathRef.current = window.location.pathname;
          ph.capture("$pageview");
          setReady(true);
          window.dispatchEvent(new Event(POSTHOG_READY_EVENT));
        },
      });
    });
  }, [enabled]);

  // Fire $pageview on client-side route changes. The loaded callback fires the
  // first one and records its path; we only fire for genuinely new paths after.
  useEffect(() => {
    if (!enabled || !ready || !consentRef.current) return;
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    window.posthog?.capture("$pageview");
  }, [enabled, ready, pathname]);

  // Stitch the anonymous person to the Clerk user once known; reset on sign-out.
  useEffect(() => {
    if (!enabled || !ready || !consentRef.current) return;
    if (isSignedIn && userId) {
      if (identifiedRef.current === userId) return;
      identifiedRef.current = userId;
      const email = user?.primaryEmailAddress?.emailAddress;
      window.posthog?.identify(userId, email ? { email } : undefined);
    } else if (isSignedIn === false && identifiedRef.current) {
      identifiedRef.current = null;
      window.posthog?.reset();
    }
  }, [enabled, ready, isSignedIn, userId, user]);

  return null;
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (If `loaded: (ph) => …` complains, the `as unknown as Window["posthog"]` cast bridges posthog-js's full type to our minimal `PostHogClient`.)

- [ ] **Step 3: Commit**

```bash
git add components/site/posthog-provider.tsx
git commit -m "feat(analytics): consent-gated PostHog provider (lazy init, identify, pageview)"
```

---

## Task 5: Mount the provider in the layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Import the provider**

Add next to the existing `MetaPixel` import (line ~10):
```tsx
import { PostHogProvider } from "@/components/site/posthog-provider";
```

- [ ] **Step 2: Mount it next to `<MetaPixel/>`**

Immediately after the existing `<MetaPixel initialConsent={initialConsent} />` (line ~134):
```tsx
            {/* Consent-gated PostHog — dynamically loads posthog-js only after
                the visitor accepts marketing cookies. Same initialConsent as
                the banner + Meta Pixel for first-paint tracking of returning
                consented visitors. */}
            <PostHogProvider initialConsent={initialConsent} />
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. `pnpm build` confirms the layout still prerenders and the dynamic import is valid.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(analytics): mount PostHogProvider in root layout"
```

---

## Task 6: Wire the click/play funnel events

These three sites already call `trackPixel`; add the matching PostHog event beside each.

**Files:**
- Modify: `components/watch/player.tsx:32,145`
- Modify: `app/subscribe/submit-button.tsx:6-10,36`

- [ ] **Step 1: `trial_play_started` in player.tsx**

`player.tsx` already imports `trackPixel` (line 32). Add the wrapper import beside it:
```tsx
import { capturePostHog } from "@/lib/posthog-events";
```
Then in the `onTrialStart` callback (line ~142), add the PostHog capture right after the existing `trackPixel("Lead", …)` call so the body reads:
```tsx
  const onTrialStart = useCallback(() => {
    if (trialLeadFiredRef.current) return;
    trialLeadFiredRef.current = true;
    trackPixel("Lead", {
      content_name: showTitle ?? showSlug,
      content_category: "trial_preview",
    });
    capturePostHog("trial_play_started", {
      show_slug: showSlug,
      show_title: showTitle ?? showSlug,
    });
  }, [showTitle, showSlug]);
```

- [ ] **Step 2: `checkout_started` in submit-button.tsx**

Add `capturePostHog` to the imports. Change the import block (lines 6-10) to:
```tsx
import {
  MEMBERSHIP_CURRENCY,
  MEMBERSHIP_VALUE,
  trackPixel,
} from "@/lib/meta-pixel-events";
import { capturePostHog } from "@/lib/posthog-events";
```
Then in the `onClick` (after the existing `trackPixel("InitiateCheckout", …)` call, line ~41):
```tsx
        trackPixel("InitiateCheckout", {
          value: MEMBERSHIP_VALUE,
          currency: MEMBERSHIP_CURRENCY,
          content_type: "product",
          content_ids: ["matio-membership"],
        });
        capturePostHog("checkout_started", {
          value: MEMBERSHIP_VALUE,
          currency: MEMBERSHIP_CURRENCY,
        });
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/watch/player.tsx app/subscribe/submit-button.tsx
git commit -m "feat(analytics): PostHog trial_play_started + checkout_started events"
```

---

## Task 7: Wire the mount-time funnel events

These fire on mount and must wait for the SDK via `onPostHogReady`.

**Files:**
- Modify: `components/site/view-content-pixel.tsx`
- Modify: `components/site/complete-registration-pixel.tsx`

- [ ] **Step 1: `show_viewed` in view-content-pixel.tsx**

Replace the file body so both the pixel and the PostHog event fire, returning a combined cleanup:
```tsx
"use client";

import { useEffect } from "react";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";

// Fires a Meta Pixel ViewContent + PostHog show_viewed for a show detail page.
// Rendered by the server component app/(public)/shows/[slug]/page.tsx, which
// can't call fbq/posthog directly. Both fires are deferred until their
// consent-gated SDK has loaded (and never fire at all without marketing
// consent).
export function ViewContentPixel({
  slug,
  title,
  genre,
}: {
  slug: string;
  title: string;
  genre?: string | null;
}) {
  useEffect(() => {
    const offPixel = onPixelReady(() => {
      trackPixel("ViewContent", {
        content_type: "product",
        content_ids: [slug],
        content_name: title,
        ...(genre ? { content_category: genre } : {}),
      });
    });
    const offPostHog = onPostHogReady(() => {
      capturePostHog("show_viewed", {
        show_slug: slug,
        show_title: title,
        ...(genre ? { genre } : {}),
      });
    });
    return () => {
      offPixel();
      offPostHog();
    };
  }, [slug, title, genre]);
  return null;
}
```

- [ ] **Step 2: `signup_completed` in complete-registration-pixel.tsx**

Replace the file body. Keep the existing localStorage de-dupe for the pixel; add a parallel PostHog de-dupe key so `signup_completed` fires once per user, not on every `/subscribe` visit:
```tsx
"use client";

import { useEffect } from "react";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";

// Fires CompleteRegistration (Meta) + signup_completed (PostHog) once per user.
// Rendered on /subscribe, which new users hit immediately after Clerk sign-up
// (forceRedirectUrl), so it lands close to the actual registration. Both are
// browser-side and inherently consent-gated (their ready-deferral never fires
// without a loaded SDK). De-dupe via a localStorage flag keyed by user id, set
// only AFTER each event actually fires so a not-yet-loaded SDK doesn't burn it.
export function CompleteRegistrationPixel({ userId }: { userId: string }) {
  useEffect(() => {
    if (!userId) return;

    const fbKey = `matio:fb:creg:${userId}`;
    let fbDone = false;
    try {
      fbDone = !!localStorage.getItem(fbKey);
    } catch {
      // Storage blocked (private mode): fall through and fire anyway.
    }
    const offPixel = fbDone
      ? () => {}
      : onPixelReady(() => {
          trackPixel("CompleteRegistration");
          try {
            localStorage.setItem(fbKey, "1");
          } catch {
            // ignore storage write failures
          }
        });

    const phKey = `matio:ph:signup:${userId}`;
    let phDone = false;
    try {
      phDone = !!localStorage.getItem(phKey);
    } catch {
      // Storage blocked: fire anyway; PostHog funnels count first occurrence.
    }
    const offPostHog = phDone
      ? () => {}
      : onPostHogReady(() => {
          capturePostHog("signup_completed");
          try {
            localStorage.setItem(phKey, "1");
          } catch {
            // ignore storage write failures
          }
        });

    return () => {
      offPixel();
      offPostHog();
    };
  }, [userId]);
  return null;
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/site/view-content-pixel.tsx components/site/complete-registration-pixel.tsx
git commit -m "feat(analytics): PostHog show_viewed + signup_completed events"
```

---

## Task 8: Paywall events (`paywall_shown` + `signup_cta_clicked`)

**Files:**
- Modify: `components/watch/paywall.tsx`

- [ ] **Step 1: Add imports**

At the top of `paywall.tsx`, add `useEffect` and the wrapper:
```tsx
import { useEffect } from "react";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";
```

- [ ] **Step 2: Fire `paywall_shown` on mount**

Inside the `Paywall` component, right after `const t = useT();`, add:
```tsx
  useEffect(() => {
    return onPostHogReady(() => {
      capturePostHog("paywall_shown", { show_slug: showSlug });
    });
  }, [showSlug]);
```

- [ ] **Step 3: Fire `signup_cta_clicked` on both CTA branches**

On the signed-out `<SignUpButton>`'s inner `<button>` (line ~92), add an `onClick`:
```tsx
                <button
                  type="button"
                  onClick={() =>
                    capturePostHog("signup_cta_clicked", { auth: "signed_out" })
                  }
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(255,61,61,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12] active:scale-[0.98]"
                >
```
On the signed-in `<Link>` (line ~102), add the same `onClick` with `auth: "signed_in"`:
```tsx
              <Link
                href={subscribeHref}
                onClick={() =>
                  capturePostHog("signup_cta_clicked", { auth: "signed_in" })
                }
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(255,61,61,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12] active:scale-[0.98]"
              >
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/watch/paywall.tsx
git commit -m "feat(analytics): PostHog paywall_shown + signup_cta_clicked events"
```

---

## Task 9: Server-side conversion (`lib/posthog-server.ts` + webhook)

**Files:**
- Create: `lib/posthog-server.ts`
- Modify: `app/api/webhooks/stripe/route.ts:12 (imports), ~171-210`

- [ ] **Step 1: Write the server client**

Mirrors `lib/meta-capi.ts`'s contract — best-effort, never throws, no-op when unconfigured. A fresh client per call (cheap; avoids reuse-after-shutdown in Fluid Compute) with `flushAt: 1` + an awaited `shutdown()` so the event is flushed before the serverless function freezes.

```ts
import "server-only";
import { PostHog } from "posthog-node";

// Server-side PostHog (the bottom-of-funnel conversion fired from the Stripe
// webhook). Best-effort like lib/meta-capi.ts: DEGRADES to a no-op when
// unconfigured and NEVER throws, so a missing key or a PostHog outage can't
// fail subscription processing or roll back the webhook's idempotency claim.
//
// posthog-node buffers events and flushes on an interval — useless in a
// short-lived serverless function. We create a fresh client per call with
// flushAt:1 and AWAIT shutdown(), which flushes pending events before the
// function freezes. requestTimeout bounds the network call like CAPI's 3s cap.

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com";
const POSTHOG_TIMEOUT_MS = 3_000;

export async function captureServerEvent(params: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return { ok: false, skipped: true };

  const client = new PostHog(key, {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: POSTHOG_TIMEOUT_MS,
  });
  try {
    client.capture({
      distinctId: params.distinctId,
      event: params.event,
      properties: params.properties,
    });
    await client.shutdown();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "PostHog capture failed",
    };
  }
}
```

- [ ] **Step 2: Import it in the webhook**

In `app/api/webhooks/stripe/route.ts`, add beside the existing `sendCapiEvents` import (line ~12):
```ts
import { captureServerEvent } from "@/lib/posthog-server";
```

- [ ] **Step 3: Capture `subscribe_succeeded` in the transition guard**

The webhook already has `if (becameAccessGranting && metadataHasCapiConsent(sub.metadata)) { … }` (line ~171) that computes `amount`/`currency` and fires the CAPI Purchase. Add the PostHog capture **inside that same block**, after the existing CAPI `try/catch` (after line ~210, still inside the `if`). It reuses the in-scope `user`, `amount`, `currency`, and `plan`:
```ts
    // PostHog bottom-of-funnel conversion. Same transition guard + capi_consent
    // gate as the CAPI Purchase, so it fires exactly once and honors consent.
    // distinctId = Clerk user id, which the browser already identify()'d — so
    // this server event stitches onto the same person. Best-effort: never
    // throws, can't roll back the webhook idempotency claim.
    try {
      const result = await captureServerEvent({
        distinctId: user.id,
        event: "subscribe_succeeded",
        properties: {
          ...(amount !== undefined ? { value: amount } : {}),
          ...(currency ? { currency } : {}),
          plan,
        },
      });
      if (!result.ok && !result.skipped) {
        console.warn("PostHog subscribe_succeeded failed", {
          subId: sub.id,
          error: result.error,
        });
      }
    } catch (err) {
      console.warn("PostHog subscribe_succeeded threw", { subId: sub.id, err });
    }
```
> Confirm `amount`, `currency`, and `plan` are in scope at the insertion point (they are: `amount`/`currency` are declared earlier in the same `if` block; `plan` is the variable used in the subscriptions upsert). If `plan` is not in scope, drop it from `properties`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/posthog-server.ts app/api/webhooks/stripe/route.ts
git commit -m "feat(analytics): server-side subscribe_succeeded via posthog-node in webhook"
```

---

## Task 10: Legal + documentation

**Files:**
- Modify: `app/(public)/cookies/` page (PostHog cookie disclosure, ES + EN)
- Modify: `app/(public)/privacy/` page (PostHog sub-processor, ES + EN)
- Create: `docs/posthog-funnel.md`
- Modify: `docs/services.md`, `docs/architecture.md`, `docs/gotchas.md`, `CLAUDE.md`

- [ ] **Step 1: Disclose PostHog on the cookie + privacy pages**

Open the `/cookies` and `/privacy` page components, locate where existing processors/cookies are listed (the Meta Pixel / Mux disclosures), and add a bilingual entry for PostHog: an **EU-hosted product-analytics processor** that sets first-party analytics cookies and records masked session replays, **only after marketing consent**. Match the existing ES-default / EN-switcher copy structure already in those files. Keep them DRAFT (counsel review still pending, per CLAUDE.md).

- [ ] **Step 2: Write `docs/posthog-funnel.md`**

```markdown
# PostHog Funnel Analytics

Consent-gated first-party-proxied PostHog (EU Cloud) to find where the ads
funnel leaks. See `docs/superpowers/specs/2026-05-30-posthog-funnel-analytics-design.md`
for the design rationale.

## Setup (one-time, outside the repo)

1. Create a PostHog Cloud project in the **EU** region. Copy the **Project API
   Key** (`phc_…`).
2. Project settings → enable **Session replay** and **Heatmaps**.
3. Add env vars (Vercel + local `.env.local`):
   - `NEXT_PUBLIC_POSTHOG_KEY=phc_…`
   - `NEXT_PUBLIC_POSTHOG_HOST=/ingest`
   - `POSTHOG_HOST=https://eu.i.posthog.com`
   Leave them blank to keep PostHog fully off (client provider + server client
   both no-op).

## How capture works

- Loads only after `cookie_consent.marketing === true` (mirrors the Meta Pixel).
- Autocapture OFF. We send pageviews + a curated event set.
- Ingestion is proxied through `/ingest` (Next.js rewrite) to dodge ad blockers.
- The `subscribe` conversion is server-side (Stripe webhook → posthog-node),
  keyed to the Clerk user id so it stitches to the browser-identified person.

## Events

| Event | Where |
|---|---|
| `$pageview` | every route change (provider) |
| `show_viewed` | /shows/[slug] |
| `trial_play_started` | watch player, on first preview play |
| `paywall_shown` | trial-end paywall mount |
| `signup_cta_clicked` | paywall CTA (signed_out / signed_in) |
| `signup_completed` | first authed /subscribe (once per user) |
| `checkout_started` | /subscribe submit |
| `subscribe_succeeded` | Stripe webhook (server) |

## Build the funnel

In PostHog → Product analytics → New insight → **Funnel**. Steps in order:

1. Pageview where Path = `/`
2. Pageview where Path matches `/shows/.*`
3. `trial_play_started`
4. `paywall_shown`
5. `signup_cta_clicked`
6. `signup_completed`
7. Pageview where Path = `/subscribe`
8. `checkout_started`
9. `subscribe_succeeded`

Set the conversion window to ~7 days (Matio's funnel is delayed-conversion).
Add a **Breakdown** by `utm_source` (and a second saved copy by `utm_campaign`)
to see which campaign leaks at which step. Save both onto a new **"Ads funnel"**
dashboard.
```

- [ ] **Step 3: Update services / architecture / gotchas / CLAUDE**

- `docs/services.md` — add a **PostHog** section: EU Cloud, the three env vars, link to `docs/posthog-funnel.md`.
- `docs/architecture.md` — add a short "Funnel analytics (PostHog)" subsection: consent-gated provider, curated events, `/ingest` proxy, server-side conversion in the webhook transition guard; note it's additive to Meta Pixel/CAPI.
- `docs/gotchas.md` — add three traps: (a) middleware/`proxy.ts` runs **before** `next.config` rewrites, so `/ingest` must be excluded from the matcher; (b) posthog-node in serverless needs `flushAt:1` + awaited `shutdown()` or events are lost; (c) App-Router `$pageview` must be fired manually (`capture_pageview:false`) on route change since posthog-js's default only fires on full loads.
- `CLAUDE.md` — add `PostHog = POSTHOG_* / NEXT_PUBLIC_POSTHOG_*` to the env-var convention line; add a **Funnel analytics (PostHog)** bullet under "Key business rules" summarizing the consent gate + server conversion; add the new files to the file-structure block.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS (legal pages are TSX — build confirms they still compile).

- [ ] **Step 5: Commit**

```bash
git add app docs CLAUDE.md
git commit -m "docs+legal(analytics): PostHog disclosure, funnel recipe, gotchas, env"
```

---

## Task 11: End-to-end verification

No code changes — this gates "done". Set the three env vars (Task 1, Step 2) first.

- [ ] **Step 1: Build + lint + types clean**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS.

- [ ] **Step 2: Pre-consent = silent**

Run `pnpm dev`. In a fresh incognito window, open `/` with DevTools → Network (filter `ingest`) and Application → Cookies.
Expected: **zero** `/ingest` requests; **no** `ph_*` PostHog cookies; no `posthog-js` chunk loaded.

- [ ] **Step 3: Consent → events flow**

Click **Accept all** on the cookie banner.
Expected: a `posthog-js` chunk loads; `/ingest` requests begin; a `$pageview` fires. Navigate `/` → `/shows/<slug>` → expect a second `$pageview` + a `show_viewed` event (visible in PostHog → Activity, or the Network payloads).

- [ ] **Step 4: Funnel events fire**

Walk the funnel: play a trial preview (`trial_play_started`), let it hit the paywall (`paywall_shown`), click the CTA (`signup_cta_clicked`), sign up → land on `/subscribe` (`signup_completed` + `$pageview /subscribe`), click subscribe (`checkout_started`).
Expected: each event appears in PostHog → Activity for the same person; after Clerk sign-in the person is `identify`'d to the Clerk user id (anonymous events merged).

- [ ] **Step 5: Consent withdrawal halts capture**

Footer → "Cookie preferences" → **Essential only**.
Expected: `/ingest` requests stop; subsequent navigation fires no `$pageview`.

- [ ] **Step 6: Server conversion (staging/prod with live webhook)**

Complete a real Checkout (or replay a `customer.subscription.updated` into an access-granting status via Stripe CLI).
Expected: a `subscribe_succeeded` event appears in PostHog on the **same person** as the pre-signup anonymous events, exactly once (no duplicate on renewal/`invoice.paid`).

- [ ] **Step 7: Funnel renders**

In PostHog, build the funnel from `docs/posthog-funnel.md` with a `utm_source` breakdown.
Expected: end-to-end funnel renders; step-to-step drop-off and per-source breakdown are visible.

- [ ] **Step 8: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide merge/PR. (`git push origin feat/posthog-funnel-analytics`; deploy via `vercel --prod --yes` once merged, per CLAUDE.md — GitHub auto-deploy is not wired.)

---

## Self-review notes (author checklist — completed)

- **Spec coverage:** every spec section maps to a task — packages/env (T1), reverse proxy (T2), client wrapper (T3), consent-gated provider + identify + pageview (T4–T5), curated events (T6–T8), server conversion (T9), replay/heatmaps config (T4 init opts), analysis recipe + legal + docs (T10), verification (T11). No gaps.
- **No placeholders:** every code step shows complete code; the only prose-only steps are doc/legal edits (T10 S1/S3) and manual verification (T11), which are inherently descriptive.
- **Type consistency:** `capturePostHog(event: FunnelEvent, …)`, `onPostHogReady`, `POSTHOG_READY_EVENT`, `window.posthog: PostHogClient`, and `captureServerEvent({ distinctId, event, properties })` are defined in T3/T9 and used consistently in T4–T9. `subscribe_succeeded` is server-only (plain string), deliberately not in the client `FunnelEvent` union.
```
