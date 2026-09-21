/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Subscription } from "@/db/schema";
import { en } from "@/lib/i18n/dictionaries";
import { isNextLink, prefetchOf } from "@/tools/test/next-link-probe";

// The REAL page, rendered for an existing subscriber — the only branch that
// shows "Manage subscription". Everything it awaits before the JSX (user
// sync, trial linking, attribution, the subscriptions read) is stubbed at the
// module boundary; the markup under test is the page's own.
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => h.rows }),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/admin", () => ({
  getOrSyncCurrentUser: async () => ({ id: "user_test" }),
}));
vi.mock("@/lib/trial", () => ({
  linkTrialSessionsToCurrentUser: async () => undefined,
}));
vi.mock("@/lib/attribution", () => ({
  applyUserAttribution: async () => undefined,
  readAttributionCookies: async () => ({ first: {}, last: {} }),
}));
vi.mock("@/lib/free-mode", () => ({ paymentsEnabled: () => true }));
vi.mock("@/lib/i18n/server", () => ({
  getDict: async () => ({ locale: "en", t: en }),
}));

import SubscribePage from "./page";

afterEach(cleanup);

const activeSub = { plan: "monthly", status: "active" } as Subscription;

describe("/subscribe for an existing subscriber — the portal button (#259)", () => {
  it("links to the billing portal with a plain <a>, never next/link", async () => {
    // /api/billing-portal is a route handler: every GET creates a Stripe
    // portal session and answers 302. next/link would prefetch it as soon as
    // the button is on screen — i.e. on every visit to this page.
    h.rows = [activeSub];
    render(await SubscribePage({ searchParams: Promise.resolve({}) }));

    const manage = screen.getByRole("link", {
      name: en.subscribe.manageSubscription,
    });
    expect(manage.tagName).toBe("A");
    expect(manage.getAttribute("href")).toBe("/api/billing-portal");
    expect(isNextLink(manage)).toBe(false);
  });

  it("keeps the neighbouring page link on next/link's default prefetch", async () => {
    // The control: the rule is about the route handler, not about this page.
    h.rows = [activeSub];
    render(await SubscribePage({ searchParams: Promise.resolve({}) }));

    const back = screen.getByRole("link", { name: en.subscribe.backToBrowse });
    expect(back.getAttribute("href")).toBe("/");
    expect(isNextLink(back)).toBe(true);
    expect(prefetchOf(back)).toBe("default");
  });
});
