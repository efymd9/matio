"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Icon } from "@/components/site/icon";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { StatusSelect } from "@/components/admin/status-select";
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
      <Panel kicker="Identity" title="Title, slug & story">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <Field label="Title" htmlFor="title" required>
            <Input
              id="title"
              name="title"
              defaultValue={defaultValues.title}
              required
              placeholder="QUÉDATE CONMIGO"
            />
          </Field>
          <Field
            label="Slug"
            htmlFor="slug"
            required
            hint="lowercase-with-hyphens"
          >
            <Input
              id="slug"
              name="slug"
              defaultValue={defaultValues.slug}
              required
              placeholder="quedate-conmigo"
              className="font-mono sm:w-64"
            />
          </Field>
        </div>
        <Field label="Description" htmlFor="description">
          <Textarea
            id="description"
            name="description"
            defaultValue={defaultValues.description}
            rows={4}
            placeholder="One or two sentences that sell the show."
          />
        </Field>
        <Field
          label="Genre"
          htmlFor="genre"
          hint="Comma-separated. Shown as tags on the catalog."
        >
          <Input
            id="genre"
            name="genre"
            defaultValue={defaultValues.genre}
            placeholder="romance, thriller, drama"
          />
        </Field>
      </Panel>

      <Panel
        kicker="Artwork"
        title="Poster & hero"
        hint="Drop a file to upload — the preview shows the exact crop the site will render."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <ImageUploadField
            label="Poster"
            name="posterImageUrl"
            value={poster}
            onChange={(v) => {
              setPoster(v);
              setDirty(true);
            }}
            ratio="poster"
            hint="Portrait 2:3 · 1024×1536. Catalog cards + OG fallback."
          />
          <ImageUploadField
            label="Hero"
            name="heroImageUrl"
            value={hero}
            onChange={(v) => {
              setHero(v);
              setDirty(true);
            }}
            ratio="hero"
            hint="Wide ≈21:9 · 2560×1080, no baked title. Detail page + home hero. Keep subjects in the centre 60%."
          />
        </div>
      </Panel>

      <Panel kicker="Visibility" title="Status & placement">
        <div className="space-y-5">
          <Field label="Status" hint="Drafts are hidden from the public catalog.">
            <StatusSelect name="status" defaultValue={defaultValues.status} />
          </Field>

          <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">
              Homepage rows
            </p>
            <p className="mt-1 text-xs text-white/45">
              Which rows this show appears in on the home page. It can be in
              both, either, or neither (still reachable via its URL).
            </p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              <CheckCard
                name="justReleased"
                label="Just released"
                defaultChecked={defaultValues.justReleased}
              />
              <CheckCard
                name="popularNow"
                label="Popular now"
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
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
          {kicker}
        </p>
        <h2 className="mt-1 text-base font-bold tracking-tight text-white">
          {title}
        </h2>
        {hint ? <p className="mt-1 text-xs text-white/45">{hint}</p> : null}
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
      <Label htmlFor={htmlFor} className="text-white/80">
        {label}
        {required ? <span className="ml-0.5 text-[#ff3d3d]">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-[11px] text-white/40">{hint}</p> : null}
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
      <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-3 pr-9 transition-colors hover:border-white/20 hover:bg-white/[0.06] peer-checked:border-[#ff3d3d]/60 peer-checked:bg-[#ff3d3d]/[0.08] peer-focus-visible:ring-2 peer-focus-visible:ring-[#ff3d3d]/60">
        <span className="text-sm font-medium text-white/85">{label}</span>
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 flex size-5 -translate-y-1/2 scale-50 items-center justify-center rounded-full bg-[#ff3d3d] opacity-0 transition-all duration-150 peer-checked:scale-100 peer-checked:opacity-100"
      >
        <Icon name="check" size={12} color="#ffffff" />
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
  return (
    <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#141417]/90 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:px-5">
      <span className="flex items-center gap-2 text-xs text-white/50">
        <span
          className={`inline-block size-1.5 rounded-full ${
            dirty ? "bg-[#ff3d3d]" : "bg-white/25"
          }`}
        />
        {dirty ? "Unsaved changes" : "All changes saved"}
      </span>
      <div className="flex items-center gap-2">
        {cancelHref ? (
          <Link
            href={cancelHref}
            className="inline-flex h-10 items-center rounded-md border border-white/15 px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Cancel
          </Link>
        ) : null}
        <SaveButton mode={mode} />
      </div>
    </div>
  );
}

function SaveButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#ff3d3d] px-5 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.8)] transition-[transform,filter] duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? (
        <>
          <Spinner />
          <span>Saving…</span>
        </>
      ) : (
        <>
          <Icon name={mode === "create" ? "plus" : "check"} size={15} color="#ffffff" />
          <span>{mode === "create" ? "Create show" : "Save changes"}</span>
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
