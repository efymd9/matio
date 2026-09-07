"use client";

import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { Icon } from "@/components/site/icon";
import { useAdminT } from "@/lib/i18n/admin-client";
import {
  deleteEpisodeChoice,
  upsertEpisodeChoices,
  type AdminFormState,
} from "@/app/admin/actions";
import {
  BRANCH_NUMBER_FLOOR,
  FORK_FORM_FIELDS,
  FORK_WINDOW_MAX_SECONDS,
  FORK_WINDOW_MIN_SECONDS,
  MAX_CHOICES,
  type EpisodeStatus,
} from "@/lib/branching";

// The "Branching" panel of the admin episode page (#143): the branch-of
// parent select, the fork prompt (es/en), the timer, up to three options
// and a live preview of what the viewer will see. One form → one server
// action (upsertEpisodeChoices) with typed error codes rendered inline by
// FormErrorBanner. Saved options carry a per-row instant remove
// (deleteEpisodeChoice — the EpisodeAccessSelect idiom); unsaved rows just
// vanish locally. Everything is controlled state because the preview
// re-renders on every keystroke.

export type ForkPanelOption = {
  id: string;
  number: number;
  title: string;
  status: EpisodeStatus;
  branchOfEpisodeId: string | null;
};

export type ForkPanelChoice = {
  id: string;
  toEpisodeId: string;
  labelEn: string;
  labelEs: string;
  isDefault: boolean;
};

export type ForkPanelValues = {
  branchOfEpisodeId: string | null;
  forkPromptEn: string;
  forkPromptEs: string;
  forkWindowSeconds: number;
  choices: ForkPanelChoice[];
};

type Row = {
  key: number;
  // Set for rows that exist in episode_choices; null for rows added in
  // this session and not yet saved.
  id: string | null;
  toEpisodeId: string;
  labelEn: string;
  labelEs: string;
};

// Base UI's Select needs a real value for "nothing" — the hidden inputs
// translate it back to the empty string the action reads as null.
const NONE = "__none";

export function ForkPanel({
  episodeId,
  seasonId,
  showId,
  values,
  options,
}: {
  episodeId: string;
  seasonId: string;
  showId: string;
  values: ForkPanelValues;
  // Every OTHER episode of the show (never self) — candidates for the
  // parent and for the options; the action re-validates.
  options: ForkPanelOption[];
}) {
  const t = useAdminT();
  const f = FORK_FORM_FIELDS;
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    upsertEpisodeChoices.bind(null, episodeId, seasonId, showId),
    { status: "idle" },
  );
  const [removeState, setRemoveState] = useState<AdminFormState>({
    status: "idle",
  });
  const [removing, startRemove] = useTransition();

  const [branchOf, setBranchOf] = useState(values.branchOfEpisodeId ?? NONE);
  const [promptEn, setPromptEn] = useState(values.forkPromptEn);
  const [promptEs, setPromptEs] = useState(values.forkPromptEs);
  const [windowSeconds, setWindowSeconds] = useState(
    String(values.forkWindowSeconds),
  );
  const [rows, setRows] = useState<Row[]>(() =>
    values.choices.map((c, i) => ({
      key: i,
      id: c.id,
      toEpisodeId: c.toEpisodeId,
      labelEn: c.labelEn,
      labelEs: c.labelEs,
    })),
  );
  const [nextKey, setNextKey] = useState(values.choices.length);
  const [defaultKey, setDefaultKey] = useState<number>(() => {
    const i = values.choices.findIndex((c) => c.isDefault);
    return i >= 0 ? i : 0;
  });
  const [previewLocale, setPreviewLocale] = useState<"en" | "es">("en");

  const optionById = new Map(options.map((o) => [o.id, o]));
  const optionLabel = (o: ForkPanelOption) => {
    const parts = [`E${o.number} · ${o.title}`];
    if (o.branchOfEpisodeId === episodeId) parts.push(t.fork.targetBranchOfThis);
    if (o.status !== "ready") parts.push(t.fork.targetNotReady);
    return parts.join(" · ");
  };
  const targetTitle = (id: string) => {
    const o = optionById.get(id);
    return o ? `E${o.number} · ${o.title}` : "";
  };

  const updateRow = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => {
    setRows((rs) => [
      ...rs,
      { key: nextKey, id: null, toEpisodeId: "", labelEn: "", labelEs: "" },
    ]);
    setNextKey((k) => k + 1);
  };

  const removeRow = (row: Row) => {
    const drop = () => setRows((rs) => rs.filter((r) => r.key !== row.key));
    if (!row.id) {
      drop();
      return;
    }
    const savedId = row.id;
    startRemove(async () => {
      const result = await deleteEpisodeChoice(
        savedId,
        episodeId,
        seasonId,
        showId,
      );
      setRemoveState(result);
      if (result.status === "ok") drop();
    });
  };

  // Mirrors parseForkForm: a row with nothing typed is not an option.
  const kept = rows.filter((r) => r.toEpisodeId || r.labelEn || r.labelEs);
  const prompt = previewLocale === "en" ? promptEn : promptEs;
  const timer = Number(windowSeconds);

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <div className="mb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          {t.fork.panelKicker}
        </p>
        <h2 className="mt-1 text-base font-bold tracking-tight text-cream">
          {t.fork.panelTitle}
        </h2>
        <p className="mt-1 text-xs text-cream/45">{t.fork.panelHint}</p>
      </div>

      <form
        // Manual dispatch (same reason as ShowForm): React 19 resets a
        // <form action> on completion, validation errors included, and the
        // owner's half-typed fork must survive an error return.
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          startTransition(() => formAction(formData));
        }}
        className="space-y-6"
      >
        {/* Branch-of parent — hidden-input select idiom (access-select). */}
        <Field
          label={t.fork.branchOfLabel}
          hint={t.fork.branchOfHint(BRANCH_NUMBER_FLOOR)}
        >
          <input
            type="hidden"
            name={f.branchOf}
            value={branchOf === NONE ? "" : branchOf}
          />
          <Select value={branchOf} onValueChange={(v) => setBranchOf(v as string)}>
            <SelectTrigger
              className="w-full max-w-md"
              aria-label={t.fork.branchOfLabel}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t.fork.branchOfNone}</SelectItem>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {optionLabel(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Fork */}
        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
          <p className="text-sm font-semibold text-cream">{t.fork.forkTitle}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-cream/45">
            {t.fork.forkHint}
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t.fork.promptEn} htmlFor="forkPromptEn">
              <Input
                id="forkPromptEn"
                name={f.promptEn}
                value={promptEn}
                onChange={(e) => setPromptEn(e.target.value)}
                placeholder={t.fork.promptPlaceholderEn}
              />
            </Field>
            <Field label={t.fork.promptEs} htmlFor="forkPromptEs">
              <Input
                id="forkPromptEs"
                name={f.promptEs}
                value={promptEs}
                onChange={(e) => setPromptEs(e.target.value)}
                placeholder={t.fork.promptPlaceholderEs}
              />
            </Field>
          </div>

          <div className="mt-4 max-w-xs">
            <Field
              label={t.fork.windowLabel}
              htmlFor="forkWindowSeconds"
              hint={t.fork.windowHint(
                FORK_WINDOW_MIN_SECONDS,
                FORK_WINDOW_MAX_SECONDS,
              )}
            >
              <Input
                id="forkWindowSeconds"
                name={f.window}
                type="number"
                min={FORK_WINDOW_MIN_SECONDS}
                max={FORK_WINDOW_MAX_SECONDS}
                step={1}
                value={windowSeconds}
                onChange={(e) => setWindowSeconds(e.target.value)}
                className="w-28 text-center"
              />
            </Field>
          </div>

          {/* Options */}
          <div className="mt-5 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cream/55">
              {t.fork.choicesTitle}
            </p>
            {rows.map((row, i) => (
              <div
                key={row.key}
                data-testid="fork-choice-row"
                className="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-cream/70">
                    {t.fork.choiceN(i + 1)}
                  </span>
                  <label className="flex items-center gap-2 text-[11px] text-cream/60">
                    <input
                      type="radio"
                      name={f.defaultChoice}
                      // The 0-based DOM index — what parseForkForm maps
                      // back onto the kept rows.
                      value={i}
                      checked={defaultKey === row.key}
                      onChange={() => setDefaultKey(row.key)}
                      aria-label={t.fork.defaultChoice}
                    />
                    {t.fork.defaultChoice}
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    name={f.choiceLabelEn}
                    value={row.labelEn}
                    onChange={(e) => updateRow(row.key, { labelEn: e.target.value })}
                    placeholder={t.fork.labelEn}
                    aria-label={`${t.fork.choiceN(i + 1)} · ${t.fork.labelEn}`}
                  />
                  <Input
                    name={f.choiceLabelEs}
                    value={row.labelEs}
                    onChange={(e) => updateRow(row.key, { labelEs: e.target.value })}
                    placeholder={t.fork.labelEs}
                    aria-label={`${t.fork.choiceN(i + 1)} · ${t.fork.labelEs}`}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="hidden"
                    name={f.choiceTarget}
                    value={row.toEpisodeId}
                  />
                  <Select
                    value={row.toEpisodeId || NONE}
                    onValueChange={(v) =>
                      updateRow(row.key, {
                        toEpisodeId: v === NONE ? "" : (v as string),
                      })
                    }
                  >
                    <SelectTrigger
                      className="min-w-0 flex-1"
                      aria-label={`${t.fork.choiceN(i + 1)} · ${t.fork.target}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t.fork.targetNone}</SelectItem>
                      {options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {optionLabel(o)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeRow(row)}
                    disabled={removing}
                    className="inline-flex h-8 items-center rounded-md border border-white/15 px-3 text-xs font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream disabled:opacity-50"
                  >
                    {removing && row.id ? t.fork.removePending : t.fork.removeChoice}
                  </button>
                </div>
              </div>
            ))}
            {rows.length < MAX_CHOICES ? (
              <button
                type="button"
                onClick={addRow}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-4 text-xs font-bold text-cream/85 transition-colors hover:bg-white/[0.06]"
              >
                <Icon name="plus" size={14} />
                {t.fork.addChoice}
              </button>
            ) : null}
          </div>
        </div>

        {/* Live preview */}
        <div
          data-testid="fork-preview"
          className="rounded-xl border border-gold/20 bg-black/40 p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
              {t.fork.previewTitle}
            </p>
            <div
              role="group"
              aria-label={t.fork.previewLocaleAria}
              className="flex gap-1"
            >
              {(["en", "es"] as const).map((loc) => (
                <button
                  key={loc}
                  type="button"
                  aria-pressed={previewLocale === loc}
                  onClick={() => setPreviewLocale(loc)}
                  className={
                    previewLocale === loc
                      ? "rounded-md bg-gold/20 px-2 py-0.5 text-[11px] font-bold uppercase text-gold"
                      : "rounded-md px-2 py-0.5 text-[11px] font-bold uppercase text-cream/45 hover:text-cream"
                  }
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3">
            {kept.length >= 2 ? (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-lg uppercase tracking-[0.02em] text-cream">
                    {prompt || t.fork.previewEmptyPrompt}
                  </p>
                  <span className="shrink-0 rounded-full border border-gold/40 px-2 py-0.5 font-mono text-[11px] text-gold">
                    {t.fork.previewTimer(Number.isFinite(timer) ? timer : 0)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {kept.map((row) => {
                    const label =
                      previewLocale === "en" ? row.labelEn : row.labelEs;
                    const isDefault = defaultKey === row.key;
                    return (
                      <span
                        key={row.key}
                        className={
                          isDefault
                            ? "rounded-full bg-gold-cta px-4 py-2 text-sm font-extrabold text-gold-deep"
                            : "rounded-full border border-cream/30 px-4 py-2 text-sm font-bold text-cream"
                        }
                      >
                        {label || t.fork.previewEmptyLabel}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : kept.length === 1 ? (
              <p className="text-sm text-cream/70">
                {t.fork.previewAuto(targetTitle(kept[0].toEpisodeId))}
              </p>
            ) : (
              <p className="text-sm text-cream/70">
                {branchOf === NONE ? t.fork.previewLinear : t.fork.previewEnding}
              </p>
            )}
          </div>
        </div>

        <FormErrorBanner state={state} />
        <FormErrorBanner state={removeState} />

        <div className="flex items-center justify-end gap-3">
          {state.status === "ok" && !pending ? (
            <span className="text-xs text-cream/50">{t.fork.saved}</span>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-gold-cta px-4 text-sm font-bold text-gold-deep shadow-cta transition-[filter] hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
          >
            <Icon name="check" size={15} color="#241205" />
            {pending ? t.fork.savePending : t.fork.save}
          </button>
        </div>
      </form>
    </section>
  );
}

// Client copy of the server Field in components/admin/ui.tsx (that one is
// server-only), same markup as intro-range-fields.tsx.
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
