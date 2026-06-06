"use client";

import { useFormStatus } from "react-dom";
import { Icon } from "@/components/site/icon";
import { useAdminT } from "@/lib/i18n/admin-client";

// Reusable submit button for admin server-action forms. Reads the
// wrapping <form>'s pending state via useFormStatus and swaps to a
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
  const { pending } = useFormStatus();
  const t = useAdminT();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#ff3d3d] px-5 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.8)] transition-[filter,transform] duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? (
        <>
          <Spinner />
          <span>{pendingLabel ?? t.formSubmit.savingDefault}</span>
        </>
      ) : (
        <>
          {icon ? <Icon name={icon} size={15} color="#ffffff" /> : null}
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
