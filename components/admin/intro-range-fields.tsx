"use client";

import { useRef } from "react";
import { useAdminT } from "@/lib/i18n/admin-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The skip-intro pair rule (End must be greater than Start) can't be
// expressed with native min/max attributes, and updateEpisode's server
// throw surfaces as the masked generic error page in production. This
// client leaf blocks submit in the browser instead, via setCustomValidity
// with a real, localized message. The rest of the episode edit form stays
// a server component.
export function IntroRangeFields({
  defaultStart,
  defaultEnd,
}: {
  defaultStart: number | null;
  defaultEnd: number | null;
}) {
  const t = useAdminT();
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  // Both inputs re-validate on either change; blank-either is valid (the
  // server nulls the pair — the "leave both blank" contract).
  const validate = () => {
    const start = startRef.current?.value.trim() ?? "";
    const end = endRef.current?.value.trim() ?? "";
    const invalid = start !== "" && end !== "" && Number(end) <= Number(start);
    endRef.current?.setCustomValidity(
      invalid ? t.episode.introRangeError : "",
    );
  };

  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      <Field
        label={t.episode.fieldStart}
        htmlFor="introStartSeconds"
        hint={t.episode.secondsHint}
      >
        <Input
          ref={startRef}
          id="introStartSeconds"
          name="introStartSeconds"
          type="number"
          min={0}
          step={1}
          placeholder={t.episode.skipIntroPlaceholderStart}
          defaultValue={defaultStart ?? ""}
          onInput={validate}
        />
      </Field>
      <Field
        label={t.episode.fieldEnd}
        htmlFor="introEndSeconds"
        hint={t.episode.secondsHint}
      >
        <Input
          ref={endRef}
          id="introEndSeconds"
          name="introEndSeconds"
          type="number"
          min={1}
          step={1}
          placeholder={t.episode.skipIntroPlaceholderEnd}
          defaultValue={defaultEnd ?? ""}
          onInput={validate}
        />
      </Field>
    </div>
  );
}

// Client copy of the server Field in components/admin/ui.tsx (that one is
// server-only — it renders via getAdminDict-driven pages), same markup so
// these fields sit flush with the rest of the episode form.
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-cream/80">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[11px] text-cream/40">{hint}</p> : null}
    </div>
  );
}
