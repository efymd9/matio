"use client";

import { useAdminT } from "@/lib/i18n/admin-client";
import type { AdminDict } from "@/lib/i18n/admin-dictionaries";
import type { AdminFormErrorCode, AdminFormState } from "@/app/admin/actions";

// One code → dict-key map for every form that consumes AdminFormState
// (show + actor forms) so the two can't drift.
const ERROR_KEY: Record<AdminFormErrorCode, keyof AdminDict["formErrors"]> = {
  title_required: "titleRequired",
  name_required: "nameRequired",
  slug_required: "slugRequired",
  slug_invalid: "slugInvalid",
  slug_taken: "slugTaken",
  unknown: "unknown",
};

export function FormErrorBanner({ state }: { state: AdminFormState }) {
  const t = useAdminT();
  if (state.status !== "error") return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-rust/25 bg-rust/[0.08] px-3 py-2 text-sm text-rust"
    >
      {t.formErrors[ERROR_KEY[state.code]]}
    </p>
  );
}
