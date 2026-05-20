"use client";

import { useFormStatus } from "react-dom";
import { Icon } from "@/components/site/icon";

// Lives in its own client component so the parent /subscribe page stays a
// pure server component. useFormStatus reads the wrapping form's pending
// state — true from the moment the user clicks until the server action
// either errors or redirects to Stripe.
//
// While pending we swap the icon + label for a spinner + "Redirecting"
// message, disable the button (with cursor-wait), and dim it slightly.
// The press feedback (active:scale-[0.98]) fires on every click and gives
// the button the tactile feel the design lacks otherwise.
export function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      aria-busy={pending}
      className="group relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(255,61,61,0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:cursor-wait disabled:opacity-90"
    >
      {pending ? (
        <>
          <Spinner />
          <span>Redirecting to checkout…</span>
        </>
      ) : (
        <>
          <Icon name="play" size={14} color="#ffffff" />
          <span>Continue · Subscribe</span>
        </>
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
