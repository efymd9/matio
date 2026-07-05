"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useAdminT } from "@/lib/i18n/admin-client";
import { Icon } from "@/components/site/icon";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { StatusSelect } from "@/components/admin/status-select";
import { OrientationSelect } from "@/components/admin/orientation-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ShowFormValues = {
  title: string;
  slug: string;
  description: string;
  posterImageUrl: string;
  heroImageUrl: string;
  genre: string;
  status: "draft" | "published";
  orientation: "horizontal" | "vertical";
  justReleased: boolean;
  popularNow: boolean;
};

export const EMPTY_SHOW_FORM: ShowFormValues = {
  title: "",
  slug: "",
  description: "",
  posterImageUrl: "",
  heroImageUrl: "",
  genre: "",
  status: "draft",
  orientation: "horizontal",
  justReleased: false,
  popularNow: false,
};

// Unified create/edit form. Shared by /admin/shows/new and the details
// card on /admin/shows/[id] so the two surfaces can't drift. The server
// action (createShow or updateShow.bind(id)) is passed in as `action` —
// this component is purely presentational + the live-preview state.
//
// Poster/hero URLs are controlled state so the artwork previews update
// as you type. Everything else is uncontrolled (defaultValue) — cheaper,
// and the values are read from the FormData on submit anyway.
export function ShowForm({
  action,
  defaultValues,
  mode,
  cancelHref,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaultValues: ShowFormValues;
  mode: "create" | "edit";
  cancelHref?: string;
}) {
  const t = useAdminT();
  const [poster, setPoster] = useState(defaultValues.posterImageUrl);
  const [hero, setHero] = useState(defaultValues.heroImageUrl);
  const [dirty, setDirty] = useState(false);

  return (
    <form
      action={action}
      onInput={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="space-y-5 pb-28"
    >
      <Panel
        kicker={t.showForm.identityKicker}
        title={t.showForm.identityTitle}
      >
        <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <Field label={t.showForm.titleLabel} htmlFor="title" required>
            <Input
              id="title"
              name="title"
              defaultValue={defaultValues.title}
              required
              placeholder={t.showForm.titlePlaceholder}
            />
          </Field>
          <Field
            label={t.showForm.slugLabel}
            htmlFor="slug"
            required
            hint={t.showForm.slugHint}
          >
            <Input
              id="slug"
              name="slug"
              defaultValue={defaultValues.slug}
              required
              placeholder={t.showForm.slugPlaceholder}
              className="font-mono sm:w-64"
            />
          </Field>
        </div>
        <Field label={t.showForm.descriptionLabel} htmlFor="description">
          <Textarea
            id="description"
            name="description"
            defaultValue={defaultValues.description}
            rows={4}
            placeholder={t.showForm.descriptionPlaceholder}
          />
        </Field>
        <Field
          label={t.showForm.genreLabel}
          htmlFor="genre"
          hint={t.showForm.genreHint}
        >
          <Input
            id="genre"
            name="genre"
            defaultValue={defaultValues.genre}
            placeholder={t.showForm.genrePlaceholder}
          />
        </Field>
      </Panel>

      <Panel
        kicker={t.showForm.artworkKicker}
        title={t.showForm.artworkTitle}
        hint={t.showForm.artworkHint}
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <ImageUploadField
            label={t.showForm.posterLabel}
            name="posterImageUrl"
            value={poster}
            onChange={(v) => {
              setPoster(v);
              setDirty(true);
            }}
            ratio="poster"
            hint={t.showForm.posterHint}
          />
          <ImageUploadField
            label={t.showForm.heroLabel}
            name="heroImageUrl"
            value={hero}
            onChange={(v) => {
              setHero(v);
              setDirty(true);
            }}
            ratio="hero"
            hint={t.showForm.heroHint}
          />
        </div>
      </Panel>

      <Panel
        kicker={t.showForm.visibilityKicker}
        title={t.showForm.visibilityTitle}
      >
        <div className="space-y-5">
          <Field label={t.showForm.statusLabel} hint={t.showForm.statusHint}>
            <StatusSelect name="status" defaultValue={defaultValues.status} />
          </Field>

          <Field
            label={t.showForm.orientationLabel}
            hint={t.showForm.orientationHint}
          >
            <OrientationSelect
              name="orientation"
              defaultValue={defaultValues.orientation}
            />
          </Field>

          <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cream/55">
              {t.showForm.homepageRowsLabel}
            </p>
            <p className="mt-1 text-xs text-cream/45">
              {t.showForm.homepageRowsHint}
            </p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              <CheckCard
                name="justReleased"
                label={t.showForm.justReleasedLabel}
                defaultChecked={defaultValues.justReleased}
              />
              <CheckCard
                name="popularNow"
                label={t.showForm.popularNowLabel}
                defaultChecked={defaultValues.popularNow}
              />
            </div>
          </div>
        </div>
      </Panel>

      <SaveBar dirty={dirty} mode={mode} cancelHref={cancelHref} />
    </form>
  );
}

function Panel({
  kicker,
  title,
  hint,
  children,
}: {
  kicker: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <div className="mb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          {kicker}
        </p>
        <h2 className="mt-1 text-base font-bold tracking-tight text-cream">
          {title}
        </h2>
        {hint ? <p className="mt-1 text-xs text-cream/45">{hint}</p> : null}
      </div>
      <div className="space-y-5">{children}</div>
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

// Checkbox styled card. Uses the `peer-checked:` sibling combinator
// (Safari 3+) rather than `:has()` — CLAUDE.md flags `:has()` as a
// silent no-op on iOS Safari < 15.4. Both peer-checked targets (the
// tinting card and the absolutely-positioned check) are DIRECT siblings
// of the sr-only input — peer-* only reaches siblings, not descendants,
// so nesting them inside the card would silently never fire.
function CheckCard({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="relative block cursor-pointer">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-3 pr-9 transition-colors hover:border-white/20 hover:bg-white/[0.06] peer-checked:border-gold/60 peer-checked:bg-gold/[0.08] peer-focus-visible:ring-2 peer-focus-visible:ring-gold/60">
        <span className="text-sm font-medium text-cream/85">{label}</span>
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 flex size-5 -translate-y-1/2 scale-50 items-center justify-center rounded-full bg-gold opacity-0 transition-all duration-150 peer-checked:scale-100 peer-checked:opacity-100"
      >
        <Icon name="check" size={12} color="#241205" />
      </span>
    </label>
  );
}

function SaveBar({
  dirty,
  mode,
  cancelHref,
}: {
  dirty: boolean;
  mode: "create" | "edit";
  cancelHref?: string;
}) {
  const t = useAdminT();
  return (
    <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-espresso-2/90 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:px-5">
      <span className="flex items-center gap-2 text-xs text-cream/50">
        <span
          className={`inline-block size-1.5 rounded-full ${
            dirty ? "bg-gold" : "bg-white/25"
          }`}
        />
        {dirty ? t.showForm.unsavedChanges : t.showForm.allChangesSaved}
      </span>
      <div className="flex items-center gap-2">
        {cancelHref ? (
          <Link
            href={cancelHref}
            className="inline-flex h-10 items-center rounded-md border border-white/15 px-4 text-sm font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
          >
            {t.showForm.cancel}
          </Link>
        ) : null}
        <SaveButton mode={mode} />
      </div>
    </div>
  );
}

function SaveButton({ mode }: { mode: "create" | "edit" }) {
  const t = useAdminT();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-gold-cta px-5 text-sm font-bold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-[transform,filter] duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? (
        <>
          <Spinner />
          <span>{t.showForm.saving}</span>
        </>
      ) : (
        <>
          <Icon name={mode === "create" ? "plus" : "check"} size={15} color="#241205" />
          <span>
            {mode === "create"
              ? t.showForm.createShow
              : t.showForm.saveChanges}
          </span>
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
