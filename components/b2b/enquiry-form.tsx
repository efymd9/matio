"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import type { EnquiryError, EnquiryField, EnquiryResult } from "@/lib/b2b-enquiry";
import type { EnquiryFormCopy } from "@/lib/i18n/b2b-dictionaries";
import { capturePostHog, type FunnelEvent } from "@/lib/posthog-events";
import { cn } from "@/lib/utils";
import { ErrorPill, GOLD_CTA, TEXT_LINK } from "@/components/ideas/ideas-parts";

// The one client form behind /studio's brief and /licensing's screener
// request (#498). The fields are data; the rules are the server's own
// (lib/b2b-enquiry.ts), run here first so a typo never costs a round trip.
//
// Privacy: no `name` attribute on any personal field and method="post" — a
// form submitted before hydration must never do a native GET that puts the
// name or the address into the URL. The PostHog event carries NOTHING but
// its name: not the project type, not the title, nothing typed (#498).
// No console.* here — the PostHog replay records the browser console.

type Option = { readonly id: string; readonly label: string };

export type EnquiryFieldDef = {
  name: EnquiryField;
  label: string;
  placeholder?: string;
  optional?: boolean;
  maxLength?: number;
} & (
  | { kind: "text"; type?: "text" | "email"; autoComplete?: string }
  | { kind: "textarea"; rows?: number }
  | { kind: "select"; options: readonly Option[] }
);

type Values = Record<string, string>;

export type EnquiryFormCopyProps = EnquiryFormCopy & {
  aria: string;
  submit: string;
  successTitle: string;
  successBody: string;
};

export function EnquiryForm<V extends Values>({
  fields,
  initial,
  copy,
  validate,
  submit,
  event,
}: {
  fields: readonly EnquiryFieldDef[];
  initial: V;
  copy: EnquiryFormCopyProps;
  validate: (values: V & { website: string }) => EnquiryError[];
  submit: (values: V & { website: string }) => Promise<EnquiryResult>;
  event: FunnelEvent;
}) {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<EnquiryError[]>([]);
  const [failure, setFailure] = useState<"rate_limited" | "server_error" | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const websiteRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const errorOf = (name: EnquiryField) => errors.find((e) => e.field === name);

  const focusFirst = (list: EnquiryError[]) => {
    const first = list[0];
    if (!first) return;
    formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(fid(first.field))}`)?.focus();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (inFlight.current) return;
    setFailure(null);
    const input = { ...values, website: websiteRef.current?.value ?? "" };
    const local = validate(input);
    setErrors(local);
    if (local.length > 0) {
      focusFirst(local);
      return;
    }
    inFlight.current = true;
    startTransition(async () => {
      let res: EnquiryResult;
      try {
        res = await submit(input);
      } catch {
        res = { ok: false, reason: "server_error" };
      }
      inFlight.current = false;
      if (res.ok) {
        setDone(true);
        capturePostHog(event);
        return;
      }
      if (res.reason === "invalid") {
        setErrors(res.errors);
        focusFirst(res.errors);
        return;
      }
      setFailure(res.reason);
    });
  };

  if (done) {
    return (
      <div role="status" className="flex flex-col items-start gap-4 rounded-2xl border border-rust/30 bg-espresso-2 p-7 sm:p-9">
        <span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-gold-cta text-gold-deep">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <h3 className="font-display text-2xl uppercase leading-[1.05] text-cream">{copy.successTitle}</h3>
        <p className="text-[15px] leading-relaxed text-cream/75">{copy.successBody}</p>
        <button
          type="button"
          onClick={() => {
            setDone(false);
            setValues(initial);
            setErrors([]);
          }}
          className="text-sm font-semibold text-gold underline underline-offset-[3px]"
        >
          {copy.sendAnother}
        </button>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      method="post"
      noValidate
      aria-label={copy.aria}
      onSubmit={onSubmit}
      className="relative flex flex-col gap-5 rounded-2xl border border-rust/30 bg-espresso-2 p-6 sm:p-9"
    >
      {/* Honeypot: off screen, out of the tab order. A person never fills it. */}
      <input
        ref={websiteRef}
        type="text"
        name="website"
        defaultValue=""
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute top-0 -left-[9999px]"
      />

      {fields.map((f) => {
        const err = errorOf(f.name);
        const errId = err ? fid(`${f.name}-error`) : undefined;
        const common = {
          id: fid(f.name),
          value: values[f.name] ?? "",
          "aria-invalid": err ? true : undefined,
          "aria-describedby": errId,
          "aria-required": f.optional ? undefined : true,
        };
        const set = (v: string) => setValues((prev) => ({ ...prev, [f.name]: v }));
        return (
          <div key={f.name} className="flex flex-col gap-2">
            <label htmlFor={fid(f.name)} className={FIELD_LABEL}>
              <span>{f.label}</span>
              {f.optional ? <span className={OPTIONAL_TAG}>{copy.optional}</span> : null}
            </label>
            {f.kind === "text" ? (
              <input
                {...common}
                type={f.type ?? "text"}
                inputMode={f.type === "email" ? "email" : undefined}
                autoComplete={f.autoComplete}
                autoCapitalize={f.type === "email" ? "off" : undefined}
                spellCheck={f.type === "email" ? false : undefined}
                placeholder={f.placeholder}
                maxLength={f.maxLength ? f.maxLength * 2 : undefined}
                onChange={(e) => set(e.target.value)}
                className={cn(shell(Boolean(err)), "h-[52px]")}
              />
            ) : f.kind === "textarea" ? (
              <textarea
                {...common}
                rows={f.rows ?? 6}
                placeholder={f.placeholder}
                maxLength={f.maxLength ? f.maxLength * 2 : undefined}
                onChange={(e) => set(e.target.value)}
                className={cn(shell(Boolean(err)), "min-h-36 resize-y py-3.5 leading-relaxed")}
              />
            ) : (
              <select
                {...common}
                onChange={(e) => set(e.target.value)}
                className={cn(shell(Boolean(err)), "h-[52px] appearance-none bg-espresso-2")}
              >
                {f.placeholder !== undefined ? <option value="">{f.placeholder}</option> : null}
                {f.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            {err ? <ErrorPill id={errId}>{copy.errors[err.code]}</ErrorPill> : null}
          </div>
        );
      })}

      {errors.length > 0 ? <ErrorPill role="alert">{copy.summary(errors.length)}</ErrorPill> : null}
      {failure ? (
        <ErrorPill role="alert">
          {failure === "rate_limited" ? copy.rateLimited : copy.serverError}
        </ErrorPill>
      ) : null}

      <div className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={cn(GOLD_CTA, "disabled:opacity-70")}>
          {pending ? copy.sending : copy.submit}
        </button>
        <p className="text-[13px] leading-normal text-cream/60 sm:max-w-xs">
          {copy.privacy.before}
          <Link href="/privacy" className={TEXT_LINK}>
            {copy.privacy.link}
          </Link>
          {copy.privacy.after}
        </p>
      </div>
    </form>
  );
}

// The field shell of /careers: 16px text (iOS zooms on anything smaller);
// `bad` swaps the border to rust, also over the focus colour.
function shell(bad: boolean): string {
  return cn(
    "block w-full rounded-[10px] border border-white/15 bg-white/[0.06] px-4 text-base text-cream transition-[border-color,background-color] duration-150 ease-out placeholder:text-cream/40 focus:border-gold/70 focus:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60",
    bad && "border-rust/60 focus:border-rust/60",
  );
}

const FIELD_LABEL =
  "flex items-baseline justify-between gap-3 text-sm leading-[1.4] font-semibold text-cream/85";
const OPTIONAL_TAG =
  "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-cream/60";
