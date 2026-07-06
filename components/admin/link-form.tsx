"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminT } from "@/lib/i18n/admin-client";
import type { AdminDict } from "@/lib/i18n/admin-dictionaries";
import {
  buildTrackedUrl,
  canonicalizeTargetPath,
  canonicalizeUtmTriple,
  isValidTargetPath,
} from "@/lib/tracked-links";
import {
  createMarketingLink,
  type CreateLinkState,
} from "@/app/admin/links/actions";
import { FormSubmitButton } from "./form-submit-button";
import { CopyButton } from "./copy-button";

// Canonical-value presets (what lands in utm_source after aliasing). Raw
// platform names — not localized; the alias note under the field explains
// the fb/ig collapse.
const SOURCE_PRESETS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "x",
  "telegram",
  "vk",
  "reddit",
] as const;

const ERROR_KEY: Record<
  Extract<CreateLinkState, { status: "error" }>["code"],
  keyof AdminDict["links"] & string
> = {
  name_required: "errNameRequired",
  target_invalid: "errTargetInvalid",
  utm_required: "errUtmRequired",
  duplicate: "errDuplicate",
  show_not_found: "errShowNotFound",
  unknown: "errUnknown",
};

export function LinkForm({
  shows,
  origin,
}: {
  shows: { slug: string; title: string }[];
  origin: string;
}) {
  const t = useAdminT();
  const tl = t.links;
  const [state, formAction] = useActionState<CreateLinkState, FormData>(
    createMarketingLink,
    { status: "idle" },
  );

  // Controlled mirrors for the live URL preview only — the server action
  // reads the underlying form fields itself.
  const [target, setTarget] = useState<string>("home");
  const [customPath, setCustomPath] = useState("");
  const [source, setSource] = useState<string>(SOURCE_PRESETS[0]);
  const [customSource, setCustomSource] = useState("");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState("");

  const triple = canonicalizeUtmTriple({
    source: source === "custom" ? customSource : source,
    medium,
    campaign,
  });
  const path =
    target === "home"
      ? "/"
      : target === "custom"
        ? canonicalizeTargetPath(customPath)
        : target.startsWith("watch:")
          ? `/watch/${target.slice(6)}`
          : `/shows/${target.slice(5)}`;
  const pathValid = target === "custom" ? isValidTargetPath(path) : true;
  const previewUrl =
    pathValid && path && triple.source && triple.medium && triple.campaign
      ? buildTrackedUrl(origin, path, {
          source: triple.source,
          medium: triple.medium,
          campaign: triple.campaign,
        })
      : null;

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <div className="mb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          {tl.formKicker}
        </p>
        <h2 className="mt-1 text-base font-bold tracking-tight text-cream">
          {tl.formTitle}
        </h2>
      </div>

      <form action={formAction} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={tl.nameLabel} htmlFor="link-name" required hint={tl.nameHint}>
            <Input
              id="link-name"
              name="name"
              required
              maxLength={120}
              placeholder={tl.namePlaceholder}
            />
          </Field>

          <Field label={tl.targetLabel} htmlFor="link-target" required>
            <select
              id="link-target"
              name="target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={select}
            >
              <option value="home">{tl.targetHome}</option>
              {shows.map((s) => (
                <option key={`watch:${s.slug}`} value={`watch:${s.slug}`}>
                  {tl.targetWatch(s.title)}
                </option>
              ))}
              {shows.map((s) => (
                <option key={`show:${s.slug}`} value={`show:${s.slug}`}>
                  {tl.targetShow(s.title)}
                </option>
              ))}
              <option value="custom">{tl.targetCustom}</option>
            </select>
          </Field>
        </div>

        {target === "custom" ? (
          <Field
            label={tl.customPathLabel}
            htmlFor="link-custom-path"
            required
            hint={tl.customPathHint}
          >
            <Input
              id="link-custom-path"
              name="customPath"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder={tl.customPathPlaceholder}
            />
          </Field>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label={tl.sourceLabel} htmlFor="link-source" required>
            <select
              id="link-source"
              name="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className={select}
            >
              {SOURCE_PRESETS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="custom">{tl.sourceCustom}</option>
            </select>
            {source === "custom" ? (
              <Input
                name="customSource"
                value={customSource}
                onChange={(e) => setCustomSource(e.target.value)}
                placeholder={tl.sourceCustomPlaceholder}
                className="mt-1.5"
              />
            ) : null}
          </Field>

          <Field
            label={tl.mediumLabel}
            htmlFor="link-medium"
            required
            hint={tl.mediumHint}
          >
            <Input
              id="link-medium"
              name="medium"
              value={medium}
              onChange={(e) => setMedium(e.target.value)}
            />
          </Field>

          <Field
            label={tl.campaignLabel}
            htmlFor="link-campaign"
            required
            hint={tl.campaignHint}
          >
            <Input
              id="link-campaign"
              name="campaign"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder={tl.campaignPlaceholder}
            />
          </Field>
        </div>

        {/* Live preview of the canonical URL — exactly what gets stored. */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-cream/40">
            {tl.previewLabel}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <code className="break-all font-mono text-xs text-gold/90">
              {previewUrl ?? "—"}
            </code>
            {previewUrl ? (
              <CopyButton value={previewUrl} name={tl.previewCopyName} />
            ) : null}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-cream/40">
            {tl.aliasNote}
          </p>
        </div>

        {state.status === "error" ? (
          <p className="rounded-lg border border-rust/25 bg-rust/[0.08] px-3 py-2 text-sm text-rust">
            {tl[ERROR_KEY[state.code]] as string}
          </p>
        ) : null}
        {state.status === "ok" ? (
          <p className="rounded-lg border border-gold/25 bg-gold/[0.07] px-3 py-2 text-sm text-gold">
            {tl.createdOk}
          </p>
        ) : null}

        <FormSubmitButton pendingLabel={tl.submitPending} icon="plus">
          {tl.submit}
        </FormSubmitButton>
      </form>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-cream/80">
        {label}
        {required ? <span className="ml-0.5 text-rust">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-[11px] text-cream/40">{hint}</p> : null}
    </div>
  );
}

const select =
  "h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 text-sm font-medium text-cream outline-none transition-colors hover:border-white/20 focus-visible:border-gold/70 [&>option]:bg-[#15151a] [&>option]:text-cream";
