"use client";

import { useFormStatus } from "react-dom";
import { Icon } from "@/components/site/icon";
import { useAdminT } from "@/lib/i18n/admin-client";
import { useTypedActionPending } from "@/components/admin/typed-action-form";

// Reusable submit button for admin server-action forms. Reads the
// wrapping form's pending state (useFormStatus for a <form action>,
// TypedActionForm's context for a hand-dispatched one) and swaps to a
// spinner + label while the action runs. Lives in its own client
// component so the pages embedding it can stay server components.
export function FormSubmitButton({
  children,
  pendingLabel,
  icon,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  icon?: "check" | "plus";
}) {
  // Two kinds of form use this button. A <form action={serverAction}>
  // reports through useFormStatus; TypedActionForm dispatches by hand, and
  // useFormStatus cannot see that (there is no form action), so it reports
  // through its own context. Exactly one of them is ever true.
  const { pending: nativePending } = useFormStatus();
  const dispatchedPending = useTypedActionPending();
  const pending = nativePending || dispatchedPending;
  const t = useAdminT();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-gold-cta px-5 text-sm font-bold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-[filter,transform] duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? (
        <>
          <Spinner />
          <span>{pendingLabel ?? t.formSubmit.savingDefault}</span>
        </>
      ) : (
        <>
          {icon ? <Icon name={icon} size={15} color="#241205" /> : null}
          <span>{children}</span>
        </>
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
