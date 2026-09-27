"use client";

import Image from "next/image";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon } from "@/components/site/icon";
import { Poster } from "@/components/site/poster";
import { CONSENT_CHANGED_EVENT, COOKIE_PREFS_EVENT } from "@/lib/cookie-consent";
import {
  BURGUNDY_GLOW,
  HERO_SCRIM_BOTTOM,
  HERO_SCRIM_SIDE,
  toneFor,
} from "@/lib/design";
import type { Locale } from "@/lib/i18n/dictionaries";
import { ideasDictFor, type IdeasDict } from "@/lib/i18n/ideas-dictionaries";
import {
  IDEA_LIMITS,
  NEW_SERIES_VALUE,
  ideaTextLength,
  validateIdeaInput,
  type IdeaField,
  type IdeaFieldCode,
  type IdeaFieldError,
  type IdeaSubmissionInput,
  type IdeaSubmissionResult,
} from "@/lib/idea-submission";
import { trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog } from "@/lib/posthog-events";
import { localizedPath } from "@/lib/seo";
import { cn } from "@/lib/utils";
import {
  CARD,
  ErrorPill,
  GOLD_CTA,
  GUTTER,
  MONO_LABEL,
  SectionHeading,
  TEXT_LINK,
} from "./ideas-parts";
import { IdeasTermsLink, IdeasTermsSheet, TermsOpenerProvider } from "./ideas-terms";

// The /ideas story-idea form (#297, design variant A "What If…"): the
// logline in the hero (chapter 1), then "Your story" and "Your credit", a
// sticky "Next" bar on phones, a "Your pitch" rail on desktop, the Terms
// sheet, and the success card in place of chapters 2–3.
//
// NO console logging anywhere in this folder: the PostHog session replay records
// the browser console in clear text (capture_console_log_opt_in), and the
// replay's input masking does not reach it.
//
// The server action arrives as a PROP (`submitIdea`), so the Lab and the
// jsdom tests run without a server module. It is typed never to reject, and
// it is still called inside a try/catch: a dropped connection in an in-app
// browser, or "Failed to find Server Action" in a tab opened from an ad
// before a deploy, rejects the promise — and an exception inside
// startTransition goes to the error boundary, which would replace the page
// and lose a 10,000-character draft.

export type IdeasShow = {
  slug: string;
  title: string;
  posterImageUrl: string | null;
};

// What the fan edits: the whole input minus the honeypot, which is read
// straight off its (uncontrolled) DOM node at submit.
type Draft = Omit<IdeaSubmissionInput, "website">;

const EMPTY_DRAFT: Draft = {
  series: "",
  workingTitle: "",
  logline: "",
  story: "",
  name: "",
  email: "",
  ageConfirmed: false,
  termsAccepted: false,
  marketingOptIn: false,
};

// Which validation field each draft key feeds (the opt-in has none).
const FIELD_OF: Record<keyof Draft, IdeaField | null> = {
  series: "series",
  workingTitle: "workingTitle",
  logline: "logline",
  story: "story",
  name: "name",
  email: "email",
  ageConfirmed: "age",
  termsAccepted: "terms",
  marketingOptIn: null,
};

// The bar's "Next" walks the REQUIRED fields in the design's order, which
// differs from the submit order validateIdeaInput reports in.
const NEXT_ORDER: IdeaField[] = [
  "series",
  "logline",
  "story",
  "name",
  "email",
  "age",
  "terms",
];

function errorCopy(t: IdeasDict, code: IdeaFieldCode): string {
  switch (code) {
    case "logline_required":
      return t.errors.loglineRequired;
    case "logline_too_long":
      return t.errors.loglineTooLong;
    // series_unknown (the slug is not a published show) reads like
    // series_required, so the answer cannot probe which shows exist.
    case "series_required":
    case "series_unknown":
      return t.errors.series;
    case "title_too_long":
      return t.errors.title;
    case "story_required":
      return t.errors.storyRequired;
    case "story_too_long":
      return t.errors.storyTooLong;
    case "name_required":
      return t.errors.nameRequired;
    case "name_too_long":
      return t.errors.nameTooLong;
    case "email_invalid":
      return t.errors.email;
    case "age_required":
      return t.errors.age;
    case "terms_required":
      return t.errors.terms;
  }
}

function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "smooth";
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

// jsdom (and very old browsers) have no scrollIntoView — guard every call.
function scrollToEl(el: Element | null, block: ScrollLogicalPosition) {
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ behavior: scrollBehavior(), block });
  }
}

// The cookie banner (components/site/cookie-banner.tsx) marks its root with
// `data-cookie-banner` while it is on screen; the bar stays out of its way.
function cookieBannerShown(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector("[data-cookie-banner]") !== null
  );
}

function isTypingField(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  return (
    el instanceof HTMLInputElement &&
    el.type !== "checkbox" &&
    el.name !== "website"
  );
}

// Auto-growing textarea: JS measures, CSS bounds. The min/max per breakpoint
// live in the classes (min-h-[…] max-h-[…] xl:…); the height we set is only
// the content's height, which min-/max-height then clamp — so one
// measurement works at every width, overflow scrolls inside past the max,
// and nothing depends on `field-sizing: content` (Chrome-only today).
function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // +2: the 1px top and bottom borders (border-box sizing).
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [ref, value]);
}

// The field shell of the design system, 16px text (iOS zooms on anything
// smaller). `bad` swaps the border to rust — also over the focus colour.
function shell(bad: boolean): string {
  return cn(
    "block w-full rounded-md border border-white/15 bg-white/[0.06] px-4 text-base text-cream transition-[border-color,background-color] duration-150 ease-out placeholder:text-cream/35 focus:border-gold/70 focus:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60",
    bad && "border-rust/60 focus:border-rust/60",
  );
}

const FIELD_LABEL = "text-[13px] leading-[1.4] font-semibold text-cream/75";
const FIELD_HELP = "text-[13px] leading-normal text-cream/65";
const COUNTER =
  "flex-none whitespace-nowrap py-0.5 font-mono text-[11px] tracking-[0.05em] text-cream/55";

function Counter({
  count,
  limit,
  format,
  t,
}: {
  count: number;
  limit: number;
  format: (n: number) => string;
  t: IdeasDict;
}) {
  const over = count - limit;
  if (over > 0) {
    return (
      <span className={cn(COUNTER, "rounded bg-rust/30 px-1.5 text-cream")}>
        {format(count)} / {format(limit)} · {t.over(format(over))}
      </span>
    );
  }
  return (
    <span className={COUNTER}>
      {format(count)} / {format(limit)}
    </span>
  );
}

function ChapterHeading({ label, title }: { label: string; title: string }) {
  return (
    <div className="flex flex-col gap-2 xl:gap-2.5">
      <div className={MONO_LABEL}>{label}</div>
      <SectionHeading>{title}</SectionHeading>
    </div>
  );
}

function RailCheck({ done, label }: { done: boolean; label: string }) {
  return done ? (
    <span role="img" aria-label={label} className="flex text-gold">
      <Icon name="check" size={14} />
    </span>
  ) : (
    <span aria-hidden className="block size-3 rounded-full border border-cream/35" />
  );
}

export function IdeasLanding({
  locale,
  shows,
  preselectedSlug,
  heroImageUrl,
  submitIdea,
  children,
}: {
  locale: Locale;
  /** Published shows in catalog order — slug, title and poster only. */
  shows: IdeasShow[];
  /** A published show's slug from `?show=` (the page validated it), or null. */
  preselectedSlug: string | null;
  heroImageUrl: string | null;
  submitIdea: (input: IdeaSubmissionInput) => Promise<IdeaSubmissionResult>;
  /** The server-rendered How-it-works + FAQ, under the form. */
  children?: ReactNode;
}) {
  const t = ideasDictFor(locale);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const format = useMemo(() => {
    const nf = new Intl.NumberFormat(locale);
    return (n: number) => nf.format(n);
  }, [locale]);

  const [draft, setDraft] = useState<Draft>(() => ({
    ...EMPTY_DRAFT,
    series: preselectedSlug ?? "",
  }));
  // Field errors show only after the first attempt to send.
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<IdeaFieldError[]>([]);
  const [serverPill, setServerPill] = useState<
    "rate_limited" | "server_error" | null
  >(null);
  const [success, setSuccess] = useState<{
    name: string;
    email: string;
    onList: boolean;
  } | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inFlight = useRef(false);

  // The sticky bar's inputs.
  const [armed, setArmed] = useState(false);
  const [typing, setTyping] = useState(false);
  const [chapter, setChapter] = useState<1 | 2 | 3>(1);
  const [submitReached, setSubmitReached] = useState(false);
  // null until the bar is first armed — the banner is looked up then, and
  // followed through its own open/close events afterwards.
  const [bannerOpen, setBannerOpen] = useState<boolean | null>(null);

  const [scrollRequest, setScrollRequest] = useState<{
    to: "success" | "logline";
    n: number;
  } | null>(null);

  const loglineLabelRef = useRef<HTMLLabelElement>(null);
  const loglineRef = useRef<HTMLTextAreaElement>(null);
  const seriesRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const storyRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null);
  const ch2Ref = useRef<HTMLDivElement>(null);
  const ch3Ref = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  useAutoGrow(loglineRef, draft.logline);
  useAutoGrow(storyRef, draft.story);

  const fieldEl = (field: IdeaField): HTMLElement | null =>
    ({
      logline: loglineRef,
      series: seriesRef,
      workingTitle: titleRef,
      story: storyRef,
      name: nameRef,
      email: emailRef,
      age: ageRef,
      terms: termsRef,
    })[field].current;

  const goTo = (field: IdeaField) => {
    const el = fieldEl(field);
    scrollToEl(el, "center");
    el?.focus({ preventScroll: true });
  };

  // ── Derived state ───────────────────────────────────────────────────────
  const clientErrors = useMemo(
    () => validateIdeaInput({ ...draft, website: "" }),
    [draft],
  );
  const shown = new Map<IdeaField, IdeaFieldCode>();
  if (submitted) {
    for (const e of clientErrors) if (!shown.has(e.field)) shown.set(e.field, e.code);
  }
  for (const e of serverErrors) if (!shown.has(e.field)) shown.set(e.field, e.code);

  const loglineLength = ideaTextLength(draft.logline);
  const storyLength = ideaTextLength(draft.story);
  const loglineOver = loglineLength > IDEA_LIMITS.logline;
  const storyOver = storyLength > IDEA_LIMITS.story;
  const bad = (field: IdeaField) =>
    shown.has(field) ||
    (field === "logline" && loglineOver) ||
    (field === "story" && storyOver);
  const errorId = (field: IdeaField) => id(`${field}-error`);
  const describedBy = (field: IdeaField, ...rest: string[]) =>
    [...rest, shown.has(field) ? errorId(field) : null].filter(Boolean).join(" ") ||
    undefined;
  const pill = (field: IdeaField) => {
    const code = shown.get(field);
    return code ? <ErrorPill id={errorId(field)}>{errorCopy(t, code)}</ErrorPill> : null;
  };

  const chosenShow = shows.find((s) => s.slug === draft.series) ?? null;
  const isNewSeries = draft.series === NEW_SERIES_VALUE;
  const invalid = new Set(clientErrors.map((e) => e.field));
  const railDone = {
    1: !!success || !invalid.has("logline"),
    2:
      !!success ||
      (!invalid.has("series") && !invalid.has("workingTitle") && !invalid.has("story")),
    3:
      !!success ||
      (!invalid.has("name") &&
        !invalid.has("email") &&
        !invalid.has("age") &&
        !invalid.has("terms")),
  };

  const barShown =
    armed && !success && !typing && !submitReached && !termsOpen && !bannerOpen;

  // ── Field updates ───────────────────────────────────────────────────────
  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    const field = FIELD_OF[key];
    // A server verdict on a field lasts until the field is edited.
    if (field) setServerErrors((errs) => errs.filter((e) => e.field !== field));
    // Editing the address takes the rate-limit / generic pill down.
    if (key === "email") setServerPill(null);
  };

  const onLoglineChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setField("logline", value);
    if (!armed && value.length > 0) {
      setArmed(true);
      if (bannerOpen === null) setBannerOpen(cookieBannerShown());
    }
  };

  // ── The bar's inputs: focus, chapter in view, the submit button, banner ─
  const onFormFocus = (e: FocusEvent<HTMLFormElement>) => {
    if (isTypingField(e.target)) setTyping(true);
  };
  const onFormBlur = (e: FocusEvent<HTMLFormElement>) => {
    if (isTypingField(e.target)) setTyping(false);
  };

  useEffect(() => {
    const update = () => {
      const probe = window.innerHeight * 0.45;
      const top = (el: HTMLElement | null) =>
        el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
      setChapter(
        top(ch3Ref.current) <= probe ? 3 : top(ch2Ref.current) <= probe ? 2 : 1,
      );
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // The bar hides once the submit button is on screen — or scrolled past.
  // No IntersectionObserver (jsdom, very old browsers) → the bar just never
  // hides for that reason.
  useEffect(() => {
    const el = submitRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setSubmitReached(entry.isIntersecting || entry.boundingClientRect.top < 0);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [success]);

  useEffect(() => {
    const open = () => setBannerOpen(true);
    const close = () => setBannerOpen(false);
    window.addEventListener(COOKIE_PREFS_EVENT, open);
    window.addEventListener(CONSENT_CHANGED_EVENT, close);
    return () => {
      window.removeEventListener(COOKIE_PREFS_EVENT, open);
      window.removeEventListener(CONSENT_CHANGED_EVENT, close);
    };
  }, []);

  // Scrolls that need the new tree committed first (success card, reset).
  useEffect(() => {
    if (!scrollRequest) return;
    scrollToEl(
      scrollRequest.to === "success" ? successRef.current : loglineLabelRef.current,
      "center",
    );
  }, [scrollRequest]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const openTerms = () => setTermsOpen(true);

  const onPitch = () => {
    scrollToEl(ch2Ref.current, "start");
    seriesRef.current?.focus({ preventScroll: true });
  };

  const onNext = () => {
    const target = NEXT_ORDER.find((f) => invalid.has(f));
    if (target) goTo(target);
    else scrollToEl(submitRef.current, "center");
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (inFlight.current) return;
    setSubmitted(true);
    setServerPill(null);
    setServerErrors([]);
    const input: IdeaSubmissionInput = {
      ...draft,
      website: websiteRef.current?.value ?? "",
    };
    const errors = validateIdeaInput(input);
    if (errors.length > 0) {
      goTo(errors[0].field);
      return;
    }
    inFlight.current = true;
    startTransition(async () => {
      let res: IdeaSubmissionResult;
      try {
        res = await submitIdea(input);
      } catch {
        res = { ok: false, reason: "server_error" };
      }
      inFlight.current = false;
      if (res.ok) {
        setSuccess({
          name: input.name.trim(),
          email: input.email.trim(),
          onList: res.onList,
        });
        setSubmitted(false);
        setTyping(false);
        setScrollRequest((r) => ({ to: "success", n: (r?.n ?? 0) + 1 }));
        // Enums and a slug — never anything the fan typed. Both helpers are
        // no-ops until marketing consent loaded the SDKs.
        capturePostHog(
          "idea_submitted",
          input.series === NEW_SERIES_VALUE
            ? { idea_kind: "new_series" }
            : { idea_kind: "continuation", show_slug: input.series },
        );
        trackPixel("SubmitApplication", { content_category: "story_idea" });
        return;
      }
      if (res.reason === "invalid") {
        setServerErrors(res.errors);
        if (res.errors[0]) goTo(res.errors[0].field);
        return;
      }
      setServerPill(res.reason);
    });
  };

  const onAgain = () => {
    setDraft((d) => ({ ...EMPTY_DRAFT, name: d.name, email: d.email }));
    setSuccess(null);
    setSubmitted(false);
    setServerErrors([]);
    setServerPill(null);
    setArmed(false);
    setScrollRequest((r) => ({ to: "logline", n: (r?.n ?? 0) + 1 }));
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const summaryShown = shown.size > 0 && !isPending;
  const storyPlaceholder = chosenShow
    ? t.story.placeholderShow(chosenShow.title)
    : t.story.placeholderNew;

  const textInput = (
    field: "workingTitle" | "name" | "email",
    ref: RefObject<HTMLInputElement | null>,
    copy: { label: string; placeholder: string; help: string },
    extra: InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={id(field)} className={FIELD_LABEL}>
        {copy.label}
      </label>
      <div className="flex flex-col gap-1.5">
        <input
          ref={ref}
          id={id(field)}
          name={field}
          value={draft[field]}
          onChange={(e) => setField(field, e.target.value)}
          placeholder={copy.placeholder}
          aria-invalid={bad(field) || undefined}
          aria-describedby={describedBy(field, id(`${field}-help`))}
          className={cn(shell(bad(field)), "h-12")}
          {...extra}
        />
        {pill(field)}
        <p id={id(`${field}-help`)} className={FIELD_HELP}>
          {copy.help}
        </p>
      </div>
    </div>
  );

  const tick = (
    field: "age" | "terms" | "optIn",
    ref: RefObject<HTMLInputElement | null> | null,
    checked: boolean,
    onChange: (v: boolean) => void,
    text: ReactNode,
    help?: string,
  ) => {
    const errField = field === "optIn" ? null : field;
    return (
      <div>
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-3 text-sm leading-[1.45] text-cream/75">
          <input
            ref={ref ?? undefined}
            type="checkbox"
            name={field}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            aria-required={errField ? true : undefined}
            aria-invalid={(errField && bad(errField)) || undefined}
            aria-labelledby={id(`${field}-text`)}
            aria-describedby={
              [help ? id(`${field}-help`) : null, errField && shown.has(errField) ? errorId(errField) : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            className="mt-0.5 size-4 flex-none cursor-pointer accent-gold"
          />
          <span className="flex flex-col gap-1">
            <span id={id(`${field}-text`)}>{text}</span>
            {help ? (
              <span id={id(`${field}-help`)} className="text-xs leading-normal text-cream/55">
                {help}
              </span>
            ) : null}
          </span>
        </label>
        {errField && shown.has(errField) ? (
          <div className="flex pb-2 pl-[26px]">{pill(errField)}</div>
        ) : null}
      </div>
    );
  };

  const serverPillCopy =
    serverPill === "rate_limited"
      ? t.errors.rateLimited
      : serverPill === "server_error"
        ? t.errors.generic
        : null;

  return (
    <TermsOpenerProvider value={openTerms}>
      <form
        noValidate
        aria-label={t.formAria}
        onSubmit={onSubmit}
        onFocus={onFormFocus}
        onBlur={onFormBlur}
        className="relative flex flex-col"
      >
        {/* Honeypot: off screen, out of the tab order, no label. A person
            never fills it; the server swallows a filled one silently. */}
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

        {/* ── Hero · chapter 1 ─────────────────────────────────────────── */}
        <section
          aria-labelledby={id("title")}
          className="relative isolate flex flex-col justify-end overflow-hidden bg-espresso max-xl:min-h-[88vh] max-xl:supports-[height:1svh]:min-h-[88svh] xl:h-screen xl:max-h-[880px] xl:min-h-[640px]"
        >
          {heroImageUrl ? (
            <Image
              src={heroImageUrl}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover object-[62%_30%]"
            />
          ) : null}
          <div aria-hidden className="duotone-strong pointer-events-none absolute inset-0" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: HERO_SCRIM_BOTTOM }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 hidden tablet:block"
            style={{ backgroundImage: HERO_SCRIM_SIDE }}
          />
          {/* Floor glow: phones/tablets over a still; everywhere when the
              hero has no still at all. */}
          <div
            aria-hidden
            className={cn(
              "glow-floor pointer-events-none absolute inset-0",
              heroImageUrl && "xl:hidden",
            )}
          />

          <div
            className={cn(
              GUTTER,
              "relative z-10 flex flex-col gap-4 pt-24 pb-7 tablet:mx-auto tablet:w-full tablet:max-w-[736px] xl:mx-0 xl:max-w-none xl:gap-6 xl:pb-[72px]",
            )}
          >
            <h1
              id={id("title")}
              className="font-display text-[46px] leading-none uppercase tracking-[0.01em] text-cream tablet:text-[62px] xl:max-w-[720px] xl:text-[84px] xl:leading-[0.98]"
            >
              {t.h1[0]}
              <br />
              {t.h1[1]}
            </h1>

            {success ? null : (
              <div className="flex flex-col gap-2 pt-1 xl:gap-3">
                <div className="flex flex-col gap-2 xl:gap-2.5">
                  <label
                    ref={loglineLabelRef}
                    htmlFor={id("logline")}
                    className={cn(MONO_LABEL, "xl:text-xs")}
                  >
                    {t.chapterLabels[1]}
                  </label>
                  <div
                    aria-hidden
                    className="font-display text-[34px] leading-none uppercase tracking-[0.01em] text-gold xl:text-[56px]"
                  >
                    {t.whatIf}
                  </div>
                </div>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                  <div className="flex flex-col gap-1.5 xl:w-[560px] xl:flex-none">
                    <textarea
                      ref={loglineRef}
                      id={id("logline")}
                      name="logline"
                      // Two rows before JS measures: desktop's 78px; the
                      // phone's 103px min-height takes over below xl.
                      rows={2}
                      value={draft.logline}
                      onChange={onLoglineChange}
                      placeholder={t.logline.placeholder}
                      aria-required
                      aria-invalid={bad("logline") || undefined}
                      aria-describedby={describedBy("logline", id("logline-help"))}
                      className={cn(
                        shell(bad("logline")),
                        "min-h-[103px] max-h-[129px] resize-none overflow-y-auto py-3 leading-[1.6] xl:min-h-[78px]",
                      )}
                    />
                    <div className="flex items-start justify-between gap-3">
                      <p id={id("logline-help")} className={FIELD_HELP}>
                        {t.logline.help}
                      </p>
                      <Counter
                        count={loglineLength}
                        limit={IDEA_LIMITS.logline}
                        format={format}
                        t={t}
                      />
                    </div>
                    {pill("logline")}
                  </div>
                  <button
                    type="button"
                    onClick={onPitch}
                    className={cn(GOLD_CTA, "w-full whitespace-nowrap xl:w-auto xl:flex-none")}
                  >
                    {t.pitchCta}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 xl:max-w-[560px]">
              <span
                aria-hidden
                className="mt-[9px] block h-0.5 w-3.5 flex-none rounded-[1px] bg-rust xl:mt-[11px]"
              />
              <p className="text-[13px] leading-normal text-cream/70 xl:text-[15px] xl:leading-[1.6]">
                {t.notContest}
              </p>
            </div>
          </div>
        </section>

        {/* ── Chapters 2–3 (or the success card) + the desktop rail ───── */}
        <div className={cn(GUTTER, "xl:pt-24")}>
          <div className="mx-auto w-full max-w-[640px] xl:grid xl:max-w-[1200px] xl:grid-cols-12 xl:items-start xl:gap-6">
            <aside
              aria-labelledby={id("rail-title")}
              className={cn(
                CARD,
                "hidden w-80 flex-col gap-5 p-6 xl:sticky xl:top-24 xl:col-span-4 xl:flex",
              )}
            >
              <div className="flex items-center gap-2">
                <span aria-hidden className="block h-0.5 w-3.5 flex-none rounded-[1px] bg-rust" />
                <h2
                  id={id("rail-title")}
                  className="font-display text-lg leading-[1.2] uppercase tracking-[0.12em] text-gold"
                >
                  {t.rail.title}
                </h2>
              </div>
              <ol className="flex flex-col border-t border-rust/20">
                {([1, 2, 3] as const).map((n) => (
                  <li
                    key={n}
                    className="flex items-center justify-between gap-3 border-b border-rust/20 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-cream/75"
                  >
                    <span>{t.rail.steps[n - 1]}</span>
                    <RailCheck done={railDone[n]} label={t.rail.done} />
                  </li>
                ))}
              </ol>
              <div className="flex items-center gap-4">
                {chosenShow ? (
                  <Poster
                    imageUrl={chosenShow.posterImageUrl}
                    tone={toneFor(chosenShow.slug)}
                    title={chosenShow.title}
                    showTitleOnPlaceholder={false}
                    className="h-24 w-16 flex-none rounded-[10px] shadow-poster"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="h-24 w-16 flex-none rounded-[10px] border border-gold/70"
                  />
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  {chosenShow || isNewSeries ? (
                    <span className="font-display text-lg leading-[1.15] uppercase tracking-[0.01em] text-cream">
                      {chosenShow ? chosenShow.title : t.rail.newSeries}
                    </span>
                  ) : (
                    <span className="text-sm leading-[1.45] text-cream/55">
                      {t.rail.choose}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span
                  aria-hidden
                  className="font-display text-base leading-none uppercase tracking-[0.01em] text-gold"
                >
                  {t.whatIf}
                </span>
                {draft.logline.trim() ? (
                  <p className="line-clamp-4 text-sm leading-[1.55] [overflow-wrap:anywhere] text-cream/75">
                    {draft.logline}
                  </p>
                ) : (
                  <p className="text-sm leading-[1.55] text-cream/55">—</p>
                )}
              </div>
              <div className="border-t border-rust/20 pt-3.5 font-mono text-[11px] uppercase tracking-[0.1em]">
                {storyOver ? (
                  <span className="rounded bg-rust/30 px-1.5 py-0.5 text-cream">
                    {t.rail.story} · {format(storyLength)} / {format(IDEA_LIMITS.story)} ·{" "}
                    {t.over(format(storyLength - IDEA_LIMITS.story))}
                  </span>
                ) : (
                  <span className="text-cream/55">
                    {t.rail.story} · {format(storyLength)} / {format(IDEA_LIMITS.story)}
                  </span>
                )}
              </div>
            </aside>

            <div className="flex flex-col xl:col-span-7 xl:col-start-6 xl:max-w-[640px]">
              {success ? (
                <div className="pt-16 xl:pt-0">
                  <div
                    ref={successRef}
                    role="status"
                    className="relative overflow-hidden rounded-3xl border border-rust/30 bg-espresso-2/95 p-6 shadow-dialog backdrop-blur-2xl xl:p-10"
                  >
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                      style={{ backgroundImage: BURGUNDY_GLOW }}
                    />
                    <div className="relative flex flex-col gap-4 xl:gap-[18px]">
                      <span
                        aria-hidden
                        className="flex size-12 items-center justify-center rounded-full border border-gold/70 text-gold xl:size-14"
                      >
                        <Icon name="check" size={22} />
                      </span>
                      <h2 className="font-display text-[30px] leading-[1.05] uppercase tracking-[0.01em] text-gold xl:text-[44px] xl:leading-none">
                        {t.success.title}
                      </h2>
                      <p className="text-[15px] leading-[1.6] text-cream/75 xl:text-base">
                        {t.success.thanks}
                        <span className="font-semibold text-cream">{success.name}</span>
                        {t.success.afterName}
                        <span className="font-semibold [overflow-wrap:anywhere] text-cream">
                          {success.email}
                        </span>
                        {t.success.afterEmail}
                      </p>
                      {success.onList ? (
                        <p className="text-sm leading-[1.55] text-cream/70 xl:text-[15px] xl:leading-[1.6]">
                          {t.success.onList}
                        </p>
                      ) : null}
                      <div className="flex pt-1 xl:pt-1.5">
                        <button
                          type="button"
                          onClick={onAgain}
                          className="inline-flex h-[52px] w-full items-center justify-center rounded-full border border-rust/60 bg-burgundy/45 px-6 text-[15px] font-semibold text-cream backdrop-blur-xl transition-colors hover:bg-burgundy/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60 xl:h-14 xl:w-auto xl:px-8"
                        >
                          {t.success.again}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Chapter 2 · Your story */}
                  <div
                    ref={ch2Ref}
                    className="flex flex-col gap-6 pt-16 tablet:pt-[88px] xl:scroll-mt-24 xl:pt-0"
                  >
                    <ChapterHeading label={t.chapter(2)} title={t.headings.story} />

                    <div className="flex flex-col gap-2">
                      <label htmlFor={id("series")} className={FIELD_LABEL}>
                        {t.series.label}
                      </label>
                      <div className="flex flex-col gap-1.5">
                        <div className="relative">
                          <select
                            ref={seriesRef}
                            id={id("series")}
                            name="series"
                            value={draft.series}
                            onChange={(e) => setField("series", e.target.value)}
                            aria-required
                            aria-invalid={bad("series") || undefined}
                            aria-describedby={describedBy("series", id("series-help"))}
                            className={cn(
                              shell(bad("series")),
                              "h-12 cursor-pointer appearance-none pr-11",
                              draft.series ? "text-cream" : "text-cream/45",
                            )}
                          >
                            <option value="" disabled className="bg-espresso-2 text-cream/55">
                              {t.series.placeholder}
                            </option>
                            {shows.map((s) => (
                              <option key={s.slug} value={s.slug} className="bg-espresso-2 text-cream">
                                {s.title}
                              </option>
                            ))}
                            {shows.length > 0 ? (
                              <option value="__divider" disabled className="bg-espresso-2 text-cream/55">
                                —
                              </option>
                            ) : null}
                            <option value={NEW_SERIES_VALUE} className="bg-espresso-2 text-cream">
                              {t.series.newOption}
                            </option>
                          </select>
                          <span
                            aria-hidden
                            className="pointer-events-none absolute top-4 right-4 flex text-cream/60"
                          >
                            <Icon name="chevron-down" size={16} />
                          </span>
                        </div>
                        {pill("series")}
                        <p id={id("series-help")} className={FIELD_HELP}>
                          {t.series.help}
                        </p>
                      </div>
                    </div>

                    {textInput("workingTitle", titleRef, t.workingTitle, {
                      type: "text",
                      autoComplete: "off",
                    })}

                    <div className="flex flex-col gap-2">
                      <label htmlFor={id("story")} className={FIELD_LABEL}>
                        {t.story.label}
                      </label>
                      <div id={id("story-help")} className="flex flex-col gap-1.5">
                        <p className={FIELD_HELP}>{t.story.help1}</p>
                        <p className={FIELD_HELP}>{t.story.help2}</p>
                      </div>
                      <div className="flex flex-col gap-1.5 pt-1">
                        <textarea
                          ref={storyRef}
                          id={id("story")}
                          name="story"
                          value={draft.story}
                          onChange={(e) => setField("story", e.target.value)}
                          placeholder={storyPlaceholder}
                          aria-required
                          aria-invalid={bad("story") || undefined}
                          aria-describedby={describedBy("story", id("story-help"))}
                          className={cn(
                            shell(bad("story")),
                            "min-h-[180px] max-h-[506px] resize-none overflow-y-auto py-3 leading-[1.6] xl:min-h-[240px] xl:max-h-[560px]",
                          )}
                        />
                        <div className="flex justify-end">
                          <Counter
                            count={storyLength}
                            limit={IDEA_LIMITS.story}
                            format={format}
                            t={t}
                          />
                        </div>
                        {pill("story")}
                      </div>
                    </div>
                  </div>

                  {/* Chapter 3 · Your credit */}
                  <div ref={ch3Ref} className="flex flex-col gap-5 pt-16 tablet:pt-[88px]">
                    <div className="flex flex-col gap-8">
                      <div className="flex flex-col gap-6">
                        <ChapterHeading label={t.chapter(3)} title={t.headings.credit} />
                        {textInput("name", nameRef, t.name, {
                          type: "text",
                          autoComplete: "name",
                          "aria-required": true,
                        })}
                        {textInput("email", emailRef, t.email, {
                          type: "email",
                          inputMode: "email",
                          autoComplete: "email",
                          autoCapitalize: "off",
                          spellCheck: false,
                          "aria-required": true,
                        })}
                      </div>

                      <div className="flex flex-col gap-4">
                        <div className={cn(CARD, "p-5 xl:p-6")}>
                          <p className="text-sm leading-[1.55] text-cream/75 xl:text-[15px] xl:leading-[1.6]">
                            {t.notContest}
                          </p>
                        </div>
                        <div className={cn(CARD, "flex flex-col gap-3.5 p-5 xl:gap-4 xl:px-7 xl:py-6")}>
                          <h3 className="font-display text-base leading-[1.2] uppercase tracking-[0.12em] text-gold xl:text-lg">
                            {t.beforeYouSend.title}
                          </h3>
                          <ul className="flex flex-col gap-2.5">
                            {t.beforeYouSend.items.map((item) => (
                              <li
                                key={item.lead}
                                className="flex items-start gap-2.5 text-sm leading-[1.55] text-cream/75 xl:gap-3 xl:text-[15px]"
                              >
                                <span
                                  aria-hidden
                                  className="mt-[9px] size-1 flex-none rounded-full bg-gold xl:mt-2.5"
                                />
                                <span>
                                  <span className="font-semibold text-cream">{item.lead}</span>{" "}
                                  {item.body}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="text-xs leading-normal text-cream/55">
                            {t.beforeYouSend.draft}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col">
                      {tick("age", ageRef, draft.ageConfirmed, (v) => setField("ageConfirmed", v), t.ticks.age)}
                      {tick(
                        "terms",
                        termsRef,
                        draft.termsAccepted,
                        (v) => setField("termsAccepted", v),
                        <>
                          {t.ticks.terms.before}
                          <IdeasTermsLink className="font-semibold">
                            {t.ticks.terms.link}
                          </IdeasTermsLink>
                          {t.ticks.terms.after}
                        </>,
                        t.ticks.termsHelp,
                      )}
                      <div aria-hidden className="my-1 h-px bg-rust/30" />
                      {tick(
                        "optIn",
                        null,
                        draft.marketingOptIn,
                        (v) => setField("marketingOptIn", v),
                        t.ticks.optIn,
                        t.ticks.optInHelp,
                      )}
                    </div>

                    <div className="flex flex-col gap-3">
                      <p className="text-[13px] leading-[1.55] text-cream/70">
                        {t.privacy.before}
                        <a
                          href={`${localizedPath("/privacy", locale)}#ideas`}
                          target="_blank"
                          rel="noopener"
                          className={cn(TEXT_LINK, "font-semibold")}
                        >
                          {t.privacy.link}
                        </a>
                        {t.privacy.after}
                      </p>
                      {summaryShown ? (
                        <ErrorPill role="alert" className="xl:self-start">
                          {t.errors.summary}
                        </ErrorPill>
                      ) : null}
                      {serverPillCopy ? (
                        <ErrorPill role="alert" className="xl:self-start">
                          {serverPillCopy}
                        </ErrorPill>
                      ) : null}
                      <button
                        ref={submitRef}
                        type="submit"
                        disabled={isPending}
                        className={cn(
                          GOLD_CTA,
                          "w-full whitespace-nowrap disabled:cursor-progress disabled:opacity-70 xl:w-auto xl:self-start",
                        )}
                      >
                        {isPending ? t.sending : t.submit}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </form>

      {children}

      {/* Phones only: the chapter in view + a jump to what is still missing.
          Never submits. */}
      <div
        aria-hidden={!barShown}
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-rust/20 bg-espresso/85 px-6 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur-xl backdrop-saturate-150 transition-[transform,opacity,visibility] duration-200 ease-out tablet:hidden",
          barShown
            ? "visible translate-y-0 opacity-100"
            : "pointer-events-none invisible translate-y-[110%] opacity-0",
        )}
      >
        <span className={cn(MONO_LABEL, "min-w-0 truncate")}>{t.chapterLabels[chapter]}</span>
        <button
          type="button"
          onClick={onNext}
          tabIndex={barShown ? undefined : -1}
          className={cn(GOLD_CTA, "h-12 flex-none px-6")}
        >
          {t.barNext}
        </button>
      </div>

      <IdeasTermsSheet
        open={termsOpen}
        onOpenChange={setTermsOpen}
        t={t}
        locale={locale}
        finalFocus={termsRef}
      />
    </TermsOpenerProvider>
  );
}
