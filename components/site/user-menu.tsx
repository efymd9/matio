"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

// Wraps Clerk's UserButton with our custom "Manage subscription" item.
// Has to live in a client component (not threaded through layout.tsx's
// authSlot prop) because Clerk's UserButton filters its children by
// component identity to find the .MenuItems / .Link / .Action slots —
// that filtering doesn't survive crossing a server→client boundary as a
// prop, so the custom items silently disappeared from the dropdown.
export function UserMenu() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal" />
        <SignUpButton mode="modal" />
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
              href="/account"
              label="Manage subscription"
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
