/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";

vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));
// The fine print sits outside Clerk's <Show> arms; rendering both arms keeps
// the assertion about the wall itself, whoever is looking at it.
vi.mock("@clerk/nextjs", () => ({
  Show: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignUpButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { useT: () => en };
});
vi.mock("@/lib/posthog-events", () => ({
  capturePostHog: vi.fn(),
  onPostHogReady: vi.fn(() => () => undefined),
}));
vi.mock("@/app/watch/actions", () => ({
  markSignupWallShown: vi.fn(async () => undefined),
}));

import { SignupWall } from "./signup-wall";

afterEach(cleanup);

function renderWall(props: { freeMode?: boolean; gate?: boolean } = {}) {
  return render(
    <SignupWall
      showSlug="the-scarlet-oath"
      showId="show-1"
      targetEpisodeId="ep-3"
      episodeNumber={3}
      memberCount={1}
      {...props}
    />,
  );
}

describe("SignupWall — the 'No card needed' fine print (#446)", () => {
  it("paid mode: says no card is needed — the account is the free step before the paywall", () => {
    renderWall();

    expect(screen.getByText(en.signupWall.noCardNeeded)).toBeTruthy();
  });

  it("free mode: never mentions a card — nothing is sold", () => {
    renderWall({ freeMode: true, gate: true });

    expect(screen.queryByText(en.signupWall.noCardNeeded)).toBeNull();
    // The wall itself is intact: the sign-up CTA is still there.
    expect(
      screen.getAllByText(en.signupWall.signUpCta).length,
    ).toBeGreaterThan(0);
  });
});
