"use client";

import { useActionState } from "react";
import type { DeleteJobApplicationState } from "@/app/admin/careers/actions";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";

// The delete button of a job application (#376) — the list row's and the
// detail page's. The action is bound by the server page (id + where to end
// up) and answers a typed state; a failure is said inline instead of the
// masked error page.
export function JobApplicationDeleteForm({
  action,
  label,
  confirm,
  failed,
}: {
  action: (
    prev: DeleteJobApplicationState,
    formData: FormData,
  ) => Promise<DeleteJobApplicationState>;
  label: string;
  confirm: string;
  failed: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <ConfirmDeleteButton message={confirm}>{label}</ConfirmDeleteButton>
      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-lg border border-rust/25 bg-rust/[0.08] px-3 py-2 text-xs text-rust"
        >
          {failed}
        </p>
      ) : null}
    </form>
  );
}
