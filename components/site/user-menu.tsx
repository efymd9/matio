"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useT } from "@/lib/i18n/client";

// Wraps Clerk's UserButton with our custom "Manage subscription" item.
// Has to live in a client component (not threaded through layout.tsx's
// authSlot prop) because Clerk's UserButton filters its children by
// component identity to find the .MenuItems / .Link / .Action slots —
// that filtering doesn't survive crossing a server→client boundary as a
// prop, so the custom items silently disappeared from the dropdown.
//
// Signed-out: a single "Sign in" pill (the design's one auth affordance —
// Clerk's sign-in modal itself carries a "create account" link for new
// users, so a separate header Sign Up trigger isn't needed). Same pill
// renders at every breakpoint; the design's mobile 36px circular icon
// variant wasn't worth a second control given /subscribe + /watch already
// carry the dedicated sign-up CTAs.
export function UserMenu() {
  const t = useT();
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-full border border-cream/14 bg-cream/10 px-5 text-[13px] font-semibold text-cream transition-colors hover:bg-cream/16 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60"
          >
            {t.header.signIn}
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton
          appearance={{
            elements: {
              userButtonAvatarBox:
                "size-8 ring-1 ring-border hover:ring-accent/70 transition",
            },
          }}
        >
          <UserButton.MenuItems>
            <UserButton.Link
              href="/api/billing-portal"
              label={t.userMenu.manageSubscription}
              labelIcon={<CreditCardIcon />}
            />
          </UserButton.MenuItems>
        </UserButton>
      </Show>
    </>
  );
}

function CreditCardIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </svg>
  );
}
