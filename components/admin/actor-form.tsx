"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useAdminT } from "@/lib/i18n/admin-client";
import { Icon } from "@/components/site/icon";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ActorFormValues = {
  name: string;
  slug: string;
  tagline: string;
  bio: string;
  avatarImageUrl: string;
};

export const EMPTY_ACTOR_FORM: ActorFormValues = {
  name: "",
  slug: "",
  tagline: "",
  bio: "",
  avatarImageUrl: "",
};

// Unified create/edit form for virtual actors — the same shape as ShowForm
// (shared by /admin/actors/new and /admin/actors/[id] so the surfaces can't
// drift). The avatar URL is controlled state so the upload preview updates;
// everything else is uncontrolled and read from FormData on submit.
export function ActorForm({
  action,
  defaultValues,
  mode,
  cancelHref,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaultValues: ActorFormValues;
  mode: "create" | "edit";
  cancelHref?: string;
}) {
  const t = useAdminT();
  const [avatar, setAvatar] = useState(defaultValues.avatarImageUrl);
  const [dirty, setDirty] = useState(false);

  return (
    <form
      action={action}
      onInput={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="space-y-5 pb-28"
    >
      <Panel
        kicker={t.actorForm.identityKicker}
        title={t.actorForm.identityTitle}
      >
        <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <Field label={t.actorForm.nameLabel} htmlFor="name" required>
            <Input
              id="name"
              name="name"
              defaultValue={defaultValues.name}
              required
              placeholder={t.actorForm.namePlaceholder}
            />
          </Field>
          <Field
            label={t.actorForm.slugLabel}
            htmlFor="slug"
            required
            hint={t.actorForm.slugHint}
          >
            <Input
              id="slug"
              name="slug"
              defaultValue={defaultValues.slug}
              required
              placeholder={t.actorForm.slugPlaceholder}
              className="font-mono sm:w-64"
            />
          </Field>
        </div>
        <Field
          label={t.actorForm.taglineLabel}
          htmlFor="tagline"
          hint={t.actorForm.taglineHint}
        >
          <Input
            id="tagline"
            name="tagline"
            defaultValue={defaultValues.tagline}
            placeholder={t.actorForm.taglinePlaceholder}
          />
        </Field>
        <Field label={t.actorForm.bioLabel} htmlFor="bio" hint={t.actorForm.bioHint}>
          <Textarea
            id="bio"
            name="bio"
            defaultValue={defaultValues.bio}
            rows={5}
            placeholder={t.actorForm.bioPlaceholder}
          />
        </Field>
      </Panel>

      <Panel
        kicker={t.actorForm.avatarKicker}
        title={t.actorForm.avatarTitle}
      >
        <ImageUploadField
          label={t.actorForm.avatarLabel}
          name="avatarImageUrl"
          value={avatar}
          onChange={(v) => {
            setAvatar(v);
            setDirty(true);
          }}
          ratio="avatar"
          hint={t.actorForm.avatarHint}
        />
      </Panel>

      <SaveBar dirty={dirty} mode={mode} cancelHref={cancelHref} />
    </form>
  );
}

function Panel({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
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
          <Icon
            name={mode === "create" ? "plus" : "check"}
            size={15}
            color="#241205"
          />
          <span>
            {mode === "create"
              ? t.actorForm.createActor
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
