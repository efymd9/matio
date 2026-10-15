"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon } from "@/components/site/icon";
import {
  CARD,
  ErrorPill,
  GOLD_CTA,
  GUTTER,
  TEXT_LINK,
} from "@/components/ideas/ideas-parts";
import { VACANCY_LIST, isJobPosition, type JobPosition, type Vacancy } from "@/lib/careers";
import { CONSENT_CHANGED_EVENT, COOKIE_PREFS_EVENT } from "@/lib/cookie-consent";
import { BURGUNDY_GLOW, HERO_SCRIM_BOTTOM, HERO_SCRIM_SIDE } from "@/lib/design";
import { en as careersEn, type CareersDict } from "@/lib/i18n/careers-dictionaries";
import {
  JOB_LIMITS,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  firstNameOf,
  jobTextLength,
  normalizeJobText,
  portfolioRequiredFor,
  validateJobApplication,
  type JobApplicationInput,
  type JobApplicationResult,
  type JobField,
  type JobFieldCode,
  type JobFieldError,
  type SocialPlatform,
} from "@/lib/job-application";
import { capturePostHog } from "@/lib/posthog-events";
import { cn } from "@/lib/utils";
import { COLUMN, MONO, SectionLabel, SplitHeading } from "./careers-parts";

// The /careers page (#376, design variant A of the "Matio Careers" canvas,
// headline "WE ARE / HIRING."): the hero over the cathedral still, the two
// role cards, How we work, What happens next, the application form (or its
// success card) and — handed in as `faq`, rendered on the server — the FAQ;
// plus the phone's "We are hiring · Apply" bar, which hides once the form is
// reached.
//
// NO console logging anywhere in this folder: the PostHog session replay
// records the browser console in clear text, and its input masking does not
// reach it (the components/ideas rule).
//
// The server action arrives as a PROP (`submitJobApplication`), so the Lab
// and the jsdom tests run without a server module. It is typed never to
// reject and is still called inside a try/catch: a dropped connection or a
// "Failed to find Server Action" after a deploy rejects the promise, and an
// exception inside startTransition would replace the page — and the
// candidate's draft — with the error boundary.

type SocialRow = { id: number; platform: SocialPlatform; value: string };

// What the candidate edits: the whole input minus the honeypot, which is read
// straight off its (uncontrolled) DOM node at submit.
type Draft = Omit<JobApplicationInput, "socials" | "website"> & {
  socials: SocialRow[];
};

type TextKey = "fullName" | "email" | "location" | "linkedinUrl" | "portfolioUrl" | "message";

// Which validation field each draft key feeds.
const FIELD_OF: Record<Exclude<keyof Draft, "socials">, JobField> = {
  position: "position",
  fullName: "fullName",
  email: "email",
  location: "location",
  linkedinUrl: "linkedin",
  portfolioUrl: "portfolio",
  message: "message",
  ageConfirmed: "age",
};

function toInput(draft: Draft, website: string): JobApplicationInput {
  return {
    ...draft,
    socials: draft.socials.map(({ platform, value }) => ({ platform, value })),
    website,
  };
}

function errorCopy(t: CareersDict, code: JobFieldCode): string {
  switch (code) {
    case "position_required":
      return t.errors.position;
    case "name_required":
      return t.errors.nameRequired;
    case "name_too_long":
      return t.errors.nameTooLong;
    case "email_required":
      return t.errors.emailRequired;
    case "email_invalid":
      return t.errors.email;
    case "location_required":
      return t.errors.locationRequired;
    case "location_too_long":
      return t.errors.locationTooLong;
    case "linkedin_invalid":
    case "portfolio_invalid":
      return t.errors.link;
    case "portfolio_required":
      return t.errors.portfolioRequired;
    case "socials_too_many":
      return t.errors.socialsTooMany;
    case "social_invalid":
      return t.errors.social;
    case "message_required":
      return t.errors.messageRequired;
    case "message_too_long":
      return t.errors.messageTooLong;
    case "age_required":
      return t.errors.age;
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

// The field shell of the design system, 16px text (iOS zooms on anything
// smaller). `bad` swaps the border to rust — also over the focus colour.
function shell(bad: boolean): string {
  return cn(
    "block w-full rounded-[10px] border border-white/15 bg-white/[0.06] px-4 text-base text-cream transition-[border-color,background-color] duration-150 ease-out placeholder:text-cream/40 focus:border-gold/70 focus:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60",
    bad && "border-rust/60 focus:border-rust/60",
  );
}

const FIELD_LABEL =
  "flex items-baseline justify-between gap-3 text-sm leading-[1.4] font-semibold text-cream/85";
const FIELD_HELP = "text-[13px] leading-normal text-cream/65";
const OPTIONAL_TAG =
  "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-cream/60";

function GroupHeading({ num, title }: { num: string; title: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="font-mono text-xs tracking-[0.1em] text-gold/85">{num}</span>
      <h3 className="font-display text-lg leading-[1.2] uppercase tracking-[0.12em] text-cream">
        {title}
      </h3>
    </div>
  );
}

function BulletList({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className={cn(MONO, "text-gold/85")}>{label}</h4>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-3 text-[15px] leading-[1.55] text-cream/80 xl:text-base"
          >
            <span aria-hidden className="mt-[9px] size-1 flex-none rounded-full bg-gold" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VacancyCard({
  vacancy,
  index,
  total,
  t,
  onApply,
}: {
  vacancy: Vacancy;
  index: number;
  total: number;
  t: CareersDict;
  onApply: (id: JobPosition) => (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const facts: [string, string][] = [];
  if (vacancy.location) facts.push([t.roles.location, vacancy.location]);
  if (vacancy.employmentType) facts.push([t.roles.employmentType, vacancy.employmentType]);
  return (
    <article
      id={vacancy.id}
      aria-labelledby={`${vacancy.id}-title`}
      className="relative isolate flex scroll-mt-6 flex-col gap-6 overflow-hidden rounded-[20px] border border-rust/30 bg-espresso-2 bg-radial-[circle_at_100%_0%] from-gold/10 to-transparent to-55% p-6 xl:gap-7 xl:p-8"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-2 -bottom-9 -z-10 font-display text-[160px] leading-none text-gold/5 xl:text-[220px]"
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="flex flex-col gap-3.5">
        <span className={cn(MONO, "text-cream/60")}>{t.roles.count(index + 1, total)}</span>
        <h3
          id={`${vacancy.id}-title`}
          className="font-display text-[32px] leading-none uppercase tracking-[0.02em] text-cream xl:text-[40px]"
        >
          {vacancy.title}
        </h3>
        <p className="text-base leading-[1.6] text-cream/80 xl:text-lg">{vacancy.summary}</p>
      </div>
      {facts.length > 0 ? (
        <dl className="flex flex-col">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-t border-rust/30 py-3 xl:grid-cols-[104px_minmax(0,1fr)] xl:gap-4"
            >
              <dt className={cn(MONO, "leading-[1.7] text-cream/60")}>{label}</dt>
              <dd className="text-[15px] leading-[1.45] text-cream">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <BulletList label={t.roles.whatYoullDo} items={vacancy.whatYoullDo} />
      <BulletList label={t.roles.whatWereLookingFor} items={vacancy.whatWereLookingFor} />
      <a
        href={`?role=${vacancy.id}#apply`}
        onClick={onApply(vacancy.id)}
        aria-label={t.roles.applyAria(vacancy.title)}
        className="mt-auto inline-flex h-12 items-center gap-2 self-start rounded-full border border-rust/60 bg-burgundy/45 px-6 text-[15px] font-semibold text-cream transition-colors hover:bg-burgundy/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60"
      >
        {t.roles.apply}
        <Icon name="chevron-right" size={16} />
      </a>
    </article>
  );
}

export function CareersLanding({
  vacancies = VACANCY_LIST,
  preselectedPosition,
  submitJobApplication,
  faq,
}: {
  /** The roles in page order (lib/careers.ts) — a prop so the Lab can vary them. */
  vacancies?: readonly Vacancy[];
  /** A role from `?role=` (the page validated it), or null. */
  preselectedPosition: JobPosition | null;
  submitJobApplication: (input: JobApplicationInput) => Promise<JobApplicationResult>;
  /** The server-rendered FAQ, placed under the form. */
  faq?: ReactNode;
}) {
  const t = careersEn;
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const format = useMemo(() => {
    const nf = new Intl.NumberFormat("en");
    return (n: number) => nf.format(n);
  }, []);

  const nextRowId = useRef(2);
  const [draft, setDraft] = useState<Draft>(() => ({
    position: preselectedPosition ?? "",
    fullName: "",
    email: "",
    location: "",
    linkedinUrl: "",
    portfolioUrl: "",
    socials: [{ id: 1, platform: "tiktok", value: "" }],
    message: "",
    ageConfirmed: false,
  }));
  // Field errors show only after the first attempt to send.
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<JobFieldError[]>([]);
  const [serverPill, setServerPill] = useState<"rate_limited" | "server_error" | null>(
    null,
  );
  const [success, setSuccess] = useState<{ firstName: string; email: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const inFlight = useRef(false);

  // The phone bar: hidden once the form is reached, after a success, and
  // while the cookie banner is up (null until first looked up).
  const [formReached, setFormReached] = useState(false);
  const [bannerOpen, setBannerOpen] = useState<boolean | null>(null);

  // A field to scroll to and focus AFTER the commit that marks it invalid —
  // so it already carries aria-invalid and its pill when a screen reader
  // announces it. `n` makes a repeat request a new value.
  const [focusRequest, setFocusRequest] = useState<{
    field: JobField;
    socialRow?: number;
    n: number;
  } | null>(null);
  const [successShown, setSuccessShown] = useState(0);

  const rolesRef = useRef<HTMLElement>(null);
  const applyRef = useRef<HTMLElement>(null);
  const formHeadRef = useRef<HTMLDivElement>(null);
  const positionInputs = useRef(new Map<string, HTMLInputElement>());
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const linkedinRef = useRef<HTMLInputElement>(null);
  const portfolioRef = useRef<HTMLInputElement>(null);
  const socialInputs = useRef(new Map<number, HTMLInputElement>());
  const addProfileRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const successTitleRef = useRef<HTMLHeadingElement>(null);

  // ── Derived state ───────────────────────────────────────────────────────
  const clientErrors = useMemo(() => validateJobApplication(toInput(draft, "")), [draft]);
  const shown = new Map<JobField, JobFieldCode>();
  // Social rows by their place among the FILLED rows — the index
  // validateJobApplication reports (an empty row is dropped, not counted).
  const filledRows = draft.socials.filter((r) => normalizeJobText(r.value).length > 0);
  const badRowIds = new Set<number>();
  for (const e of [...(submitted ? clientErrors : []), ...serverErrors]) {
    if (e.code === "social_invalid") {
      const row = e.index === undefined ? undefined : filledRows[e.index];
      if (row) badRowIds.add(row.id);
    } else if (!shown.has(e.field)) {
      shown.set(e.field, e.code);
    }
  }

  const vacancy = isJobPosition(draft.position)
    ? (vacancies.find((v) => v.id === draft.position) ?? null)
    : null;
  const portfolioRequired = portfolioRequiredFor(draft.position);
  const messageLength = jobTextLength(draft.message);
  const messageOver = messageLength > JOB_LIMITS.message;
  const bad = (field: JobField) => shown.has(field) || (field === "message" && messageOver);
  const errorId = (field: string) => id(`${field}-error`);
  const describedBy = (field: JobField, ...rest: (string | null)[]) =>
    [...rest, shown.has(field) ? errorId(field) : null].filter(Boolean).join(" ") ||
    undefined;
  const pill = (field: JobField) => {
    const code = shown.get(field);
    return code ? <ErrorPill id={errorId(field)}>{errorCopy(t, code)}</ErrorPill> : null;
  };

  const barShown = !success && !formReached && bannerOpen === false;

  // ── Field updates ───────────────────────────────────────────────────────
  const setField = <K extends Exclude<keyof Draft, "socials">>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    const field = FIELD_OF[key];
    // A server verdict on a field lasts until the field is edited.
    setServerErrors((errs) => errs.filter((e) => e.field !== field));
    // Editing the address takes the rate-limit / generic pill down.
    if (key === "email") setServerPill(null);
  };

  const setSocials = (update: (rows: SocialRow[]) => SocialRow[]) => {
    setDraft((d) => ({ ...d, socials: update(d.socials) }));
    setServerErrors((errs) => errs.filter((e) => e.field !== "socials"));
  };

  const addSocial = () =>
    setSocials((rows) => {
      if (rows.length >= JOB_LIMITS.socials) return rows;
      const used = new Set(rows.map((r) => r.platform));
      const platform = SOCIAL_PLATFORMS.find((p) => !used.has(p)) ?? "other";
      const id = nextRowId.current;
      nextRowId.current += 1;
      return [...rows, { id, platform, value: "" }];
    });

  const removeSocial = (rowId: number) => {
    setSocials((rows) => rows.filter((r) => r.id !== rowId));
    socialInputs.current.delete(rowId);
    // Focus would otherwise drop to <body> with the removed button.
    addProfileRef.current?.focus({ preventScroll: true });
  };

  // ── The bar's inputs: the form in view, the cookie banner ───────────────
  // The bar hides once the application section reaches the lower 85% of the
  // screen — or is scrolled past. No IntersectionObserver (very old
  // browsers) → the bar never shows; the hero CTA and the cards still lead
  // to the form.
  useEffect(() => {
    const el = applyRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setFormReached(entry.isIntersecting || entry.boundingClientRect.top < 0);
        setBannerOpen((open) => (open === null ? cookieBannerShown() : open));
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

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

  useEffect(() => {
    if (!focusRequest) return;
    const el: HTMLElement | null | undefined =
      focusRequest.field === "position"
        ? (positionInputs.current.values().next().value ?? null)
        : focusRequest.field === "socials"
          ? focusRequest.socialRow !== undefined
            ? socialInputs.current.get(focusRequest.socialRow)
            : addProfileRef.current
          : {
              fullName: nameRef,
              email: emailRef,
              location: locationRef,
              linkedin: linkedinRef,
              portfolio: portfolioRef,
              message: messageRef,
              age: ageRef,
            }[focusRequest.field].current;
    scrollToEl(el ?? null, "center");
    el?.focus({ preventScroll: true });
  }, [focusRequest]);

  // The success card replaces the form: the send button that had focus is
  // gone, and a status region mounted already filled is often not announced
  // — so focus lands on the card's heading. Follows a tap, never a load.
  useEffect(() => {
    if (!successShown) return;
    scrollToEl(successRef.current, "center");
    successTitleRef.current?.focus({ preventScroll: true });
  }, [successShown]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const goToRoles = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    scrollToEl(rolesRef.current, "start");
  };

  const goToForm = () => scrollToEl(formHeadRef.current ?? applyRef.current, "start");

  // A card's Apply: the role is picked in the form and the page goes there.
  // Without JavaScript the link itself does it (`?role=<id>#apply`).
  const onApply = (role: JobPosition) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!success) setField("position", role);
    goToForm();
    positionInputs.current.get(role)?.focus({ preventScroll: true });
  };

  const requestFocus = (error: JobFieldError) => {
    const socialRow =
      error.code === "social_invalid" && error.index !== undefined
        ? filledRows[error.index]?.id
        : undefined;
    setFocusRequest((r) => ({ field: error.field, socialRow, n: (r?.n ?? 0) + 1 }));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (inFlight.current) return;
    setSubmitted(true);
    setServerPill(null);
    setServerErrors([]);
    const input = toInput(draft, websiteRef.current?.value ?? "");
    const errors = validateJobApplication(input);
    if (errors.length > 0) {
      requestFocus(errors[0]);
      return;
    }
    inFlight.current = true;
    startTransition(async () => {
      let res: JobApplicationResult;
      try {
        res = await submitJobApplication(input);
      } catch {
        res = { ok: false, reason: "server_error" };
      }
      inFlight.current = false;
      if (res.ok) {
        setSuccess({ firstName: firstNameOf(input.fullName), email: input.email.trim() });
        setSubmitted(false);
        setSuccessShown((n) => n + 1);
        // The role id only — never anything the candidate typed. A no-op
        // until marketing consent loaded the SDK.
        capturePostHog("job_application_submitted", { position: input.position });
        return;
      }
      if (res.reason === "invalid") {
        setServerErrors(res.errors);
        if (res.errors[0]) requestFocus(res.errors[0]);
        return;
      }
      setServerPill(res.reason);
    });
  };

  // ── Render helpers ──────────────────────────────────────────────────────
  const textInput = (
    key: Exclude<TextKey, "message">,
    ref: RefObject<HTMLInputElement | null>,
    copy: { label: string; placeholder: string; help?: string },
    extra: InputHTMLAttributes<HTMLInputElement> & { optional?: boolean },
  ) => {
    const field = FIELD_OF[key];
    const { optional, ...attrs } = extra;
    const helpId = copy.help ? id(`${field}-help`) : null;
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={id(field)} className={FIELD_LABEL}>
          <span>{copy.label}</span>
          {optional ? <span className={OPTIONAL_TAG}>{t.form.optional}</span> : null}
        </label>
        {copy.help ? (
          <p id={helpId ?? undefined} className={FIELD_HELP}>
            {copy.help}
          </p>
        ) : null}
        <input
          ref={ref}
          id={id(field)}
          value={draft[key]}
          onChange={(e) => setField(key, e.target.value)}
          placeholder={copy.placeholder}
          aria-required={optional ? undefined : true}
          aria-invalid={bad(field) || undefined}
          aria-describedby={describedBy(field, helpId)}
          className={cn(shell(bad(field)), "h-[52px]")}
          {...attrs}
        />
        {pill(field)}
      </div>
    );
  };

  const serverPillCopy =
    serverPill === "rate_limited"
      ? t.errors.rateLimited
      : serverPill === "server_error"
        ? t.errors.generic
        : null;
  const summaryShown = shown.size + badRowIds.size > 0 && !isPending;

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        aria-labelledby={id("title")}
        className="relative isolate flex min-h-[88vh] flex-col justify-end overflow-hidden bg-espresso supports-[height:1svh]:min-h-[88svh] xl:min-h-[clamp(640px,100vh,860px)] xl:supports-[height:1svh]:min-h-[clamp(640px,100vh,860px)]"
      >
        <Image
          src="/about/hero.jpg"
          alt={t.hero.stillAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover object-[50%_40%] xl:object-[50%_35%]"
        />
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
        <div aria-hidden className="glow-floor pointer-events-none absolute inset-0 xl:hidden" />

        <div className={cn(GUTTER, "relative z-10")}>
          <div
            className={cn(
              COLUMN,
              "flex flex-col items-start gap-4 pt-24 pb-10 xl:gap-6 xl:pb-[88px]",
            )}
          >
            <span className="rounded-full bg-burgundy px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.2em] text-cream">
              {t.hero.badge}
            </span>
            <h1
              id={id("title")}
              className="font-display text-[clamp(64px,27vw,116px)] leading-[0.88] uppercase tracking-[0.02em] text-cream tablet:text-[132px] xl:text-[164px]"
            >
              {t.hero.title[0]}
              <br />
              <span className="text-gold">{t.hero.title[1]}</span>
            </h1>
            <p className="font-display text-xl leading-[1.2] uppercase tracking-[0.07em] text-gold xl:text-[30px] xl:tracking-[0.08em]">
              {t.hero.roles}
            </p>
            <p className="max-w-[600px] text-[15px] leading-[1.6] text-cream/80 xl:text-lg">
              {t.hero.pitch}
            </p>
            <a
              href="#roles"
              onClick={goToRoles}
              className={cn(GOLD_CTA, "mt-2 gap-2.5")}
            >
              {t.hero.cta}
              <Icon name="chevron-down" size={16} />
            </a>
          </div>
        </div>
      </section>

      {/* ── The roles ────────────────────────────────────────────────────── */}
      <section
        ref={rolesRef}
        id="roles"
        aria-labelledby={id("roles-title")}
        className={cn(GUTTER, "scroll-mt-6 pt-20 xl:pt-32")}
      >
        <div className={cn(COLUMN, "flex flex-col gap-7 xl:gap-14")}>
          <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:items-end xl:gap-12">
            <div className="flex flex-col gap-4 xl:gap-5">
              <SectionLabel>{t.roles.label}</SectionLabel>
              <SplitHeading id={id("roles-title")} lines={t.roles.title} />
            </div>
            <p className="text-[15px] leading-[1.6] text-cream/75 xl:pb-1.5 xl:text-lg">
              {t.roles.intro}
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2 xl:gap-6">
            {vacancies.map((v, i) => (
              <VacancyCard
                key={v.id}
                vacancy={v}
                index={i}
                total={vacancies.length}
                t={t}
                onApply={onApply}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── How we work ──────────────────────────────────────────────────── */}
      <section aria-labelledby={id("how-title")} className={cn(GUTTER, "pt-20 xl:pt-34")}>
        <div className={cn(COLUMN, "flex flex-col gap-8 xl:gap-14")}>
          <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:items-end xl:gap-12">
            <div className="flex flex-col gap-4 xl:gap-5">
              <SectionLabel>{t.how.label}</SectionLabel>
              <SplitHeading id={id("how-title")} lines={t.how.title} />
            </div>
            <p className="text-[15px] leading-[1.6] text-cream/75 xl:pb-1.5 xl:text-lg">
              {t.how.intro}
            </p>
          </div>
          <div className="grid gap-10 tablet:grid-cols-2 tablet:gap-6">
            {([
              [t.how.mission, "/about/still-mission.jpg"],
              [t.how.vision, "/about/still-vision.jpg"],
            ] as const).map(([copy, src]) => (
              <figure key={src} className="flex flex-col gap-5 xl:gap-6">
                <div className="relative aspect-[4/3] overflow-hidden rounded-[20px] border border-rust/30 bg-espresso-2 xl:aspect-auto xl:h-[340px]">
                  <Image
                    src={src}
                    alt={copy.alt}
                    fill
                    sizes="(min-width: 834px) 50vw, 100vw"
                    className="object-cover"
                  />
                  <div aria-hidden className="duotone pointer-events-none absolute inset-0" />
                </div>
                <figcaption className="flex flex-col gap-2.5 xl:pr-8">
                  <span className={cn(MONO, "text-gold/85")}>{copy.label}</span>
                  <p className="text-xl leading-[1.35] font-semibold text-cream xl:text-2xl">
                    {copy.heading}
                  </p>
                  <p className="text-[15px] leading-[1.6] text-cream/70 xl:text-base">
                    {copy.body}
                  </p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── What happens next · the form · the FAQ ──────────────────────── */}
      <section
        ref={applyRef}
        id="apply"
        aria-labelledby={id("apply-title")}
        className={cn(GUTTER, "scroll-mt-6 pt-20 pb-20 xl:pt-34 xl:pb-34")}
      >
        <div
          className={cn(
            COLUMN,
            // The form spans all three rows; the last row takes the slack,
            // so the heading, the steps and the FAQ stack without gaps.
            "flex flex-col gap-20 xl:grid xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:grid-rows-[auto_auto_1fr] xl:items-start xl:gap-x-[72px] xl:gap-y-16",
          )}
        >
          {/* The form's heading — first on desktop, after the steps on phones. */}
          <div
            ref={formHeadRef}
            className="order-2 flex scroll-mt-6 flex-col gap-4 xl:order-none xl:col-start-1 xl:row-start-1 xl:gap-5"
          >
            <SectionLabel>{t.form.label}</SectionLabel>
            <SplitHeading
              id={id("apply-title")}
              lines={t.form.title}
              className="text-[56px] leading-[0.92] xl:text-[104px] xl:leading-[0.92]"
            />
            <p className="text-[15px] leading-[1.6] text-cream/75 xl:text-lg">{t.form.intro}</p>
          </div>

          {/* What happens next */}
          <div className="order-1 flex flex-col gap-7 xl:order-none xl:col-start-1 xl:row-start-2">
            <div className="flex flex-col gap-4">
              <SectionLabel>{t.next.label}</SectionLabel>
              <SplitHeading
                lines={t.next.title}
                className="xl:text-[40px] xl:leading-none"
              />
            </div>
            <ol className="flex flex-col">
              {t.next.steps.map((step, i) => {
                const last = i === t.next.steps.length - 1;
                return (
                  <li key={step.num} className="grid grid-cols-[48px_minmax(0,1fr)] gap-4 xl:gap-5">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          "flex size-12 flex-none items-center justify-center rounded-full border font-mono text-sm font-medium",
                          last
                            ? "border-gold bg-gold text-gold-deep"
                            : "border-gold/60 bg-espresso-2 text-gold",
                        )}
                      >
                        {step.num}
                      </span>
                      {last ? null : (
                        <span aria-hidden className="min-h-6 w-px flex-1 bg-rust/50" />
                      )}
                    </div>
                    <div className={cn("flex flex-col gap-1.5 pt-[11px]", !last && "pb-[30px]")}>
                      <h3 className="text-[17px] leading-[1.4] font-bold text-cream xl:text-lg">
                        {step.title}
                      </h3>
                      <p className="text-[15px] leading-[1.55] text-cream/70 xl:text-base">
                        {step.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* The form — or, once sent, the success card in its place. */}
          <div className="order-3 xl:order-none xl:col-start-2 xl:row-span-3 xl:row-start-1">
            {success ? (
              <div
                ref={successRef}
                role="status"
                className="relative overflow-hidden rounded-3xl border border-rust/35 bg-espresso-2 p-6 shadow-dialog xl:px-14 xl:pt-14 xl:pb-[52px]"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{ backgroundImage: BURGUNDY_GLOW }}
                />
                <div className="relative flex flex-col items-start gap-5 xl:gap-[22px]">
                  <span
                    aria-hidden
                    className="flex size-14 items-center justify-center rounded-full border border-gold/70 text-gold xl:size-16"
                  >
                    <Icon name="check" size={26} />
                  </span>
                  <span className={cn(MONO, "text-gold/85")}>{t.success.kicker}</span>
                  <h2
                    ref={successTitleRef}
                    tabIndex={-1}
                    className="font-display text-[44px] leading-[0.95] uppercase tracking-[0.02em] [overflow-wrap:anywhere] text-gold outline-none xl:text-[72px]"
                  >
                    {t.success.title(success.firstName)}
                  </h2>
                  <p className="max-w-[480px] text-base leading-[1.6] text-cream/80 xl:text-lg">
                    {t.success.body[0]}
                    <span className="font-semibold [overflow-wrap:anywhere] text-cream">
                      {success.email}
                    </span>
                    {t.success.body[1]}
                  </p>
                  <Link
                    href="/"
                    className="mt-1.5 inline-flex h-14 items-center gap-2.5 rounded-full border border-rust/60 bg-burgundy/45 px-[30px] text-[15px] font-semibold text-cream transition-colors hover:bg-burgundy/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60"
                  >
                    <Icon name="play" size={14} />
                    {t.success.watch}
                  </Link>
                </div>
              </div>
            ) : (
              // method="post", and `name` only where it carries nothing
              // personal: the honeypot, and the role radios (a group needs
              // one — arrow keys, one Tab stop, "1 of 2"; its value is a
              // vacancy id). The draft is controlled state and the action
              // takes an object; a form submitted before hydration must
              // never do a native GET that puts the name, the address or the
              // message into the URL — request logs, history, and the page
              // URL every analytics tag reports.
              <form
                method="post"
                noValidate
                aria-label={t.form.aria}
                onSubmit={onSubmit}
                className="relative flex flex-col gap-9 xl:overflow-hidden xl:rounded-3xl xl:border xl:border-rust/30 xl:bg-espresso-2 xl:p-12 xl:shadow-dialog"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 hidden xl:block"
                  style={{ backgroundImage: BURGUNDY_GLOW }}
                />
                {/* Honeypot: off screen, out of the tab order, no label. A
                    person never fills it; the server swallows a filled one. */}
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

                {/* 01 · The role */}
                <div className="relative flex flex-col gap-5">
                  <GroupHeading num="01" title={t.form.groups.role} />
                  <fieldset
                    aria-describedby={describedBy("position", id("position-help"))}
                    aria-required
                    className="flex flex-col gap-2.5"
                  >
                    <legend className={cn(FIELD_LABEL, "mb-2.5")}>{t.form.position.label}</legend>
                    <div
                      className={cn(
                        "grid grid-cols-1 gap-1 rounded-[30px] border bg-white/[0.03] p-[5px] sm:grid-cols-2 sm:rounded-full",
                        bad("position") ? "border-rust/60" : "border-cream/10",
                      )}
                    >
                      {vacancies.map((v) => {
                        const on = draft.position === v.id;
                        return (
                          <label key={v.id} className="relative cursor-pointer">
                            <input
                              ref={(el) => {
                                if (el) positionInputs.current.set(v.id, el);
                                else positionInputs.current.delete(v.id);
                              }}
                              type="radio"
                              name="position"
                              value={v.id}
                              checked={on}
                              onChange={() => setField("position", v.id)}
                              className="peer sr-only"
                            />
                            <span
                              className={cn(
                                "flex h-[52px] items-center justify-center gap-2.5 rounded-full border px-3 text-[15px] whitespace-nowrap transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold/60",
                                on
                                  ? "border-gold bg-gold-cta font-extrabold text-gold-deep shadow-cta"
                                  : "border-cream/10 font-semibold text-cream hover:bg-white/[0.04]",
                              )}
                            >
                              <span
                                aria-hidden
                                className={cn(
                                  "flex size-[18px] flex-none items-center justify-center rounded-full border-[1.5px]",
                                  on ? "border-gold-deep" : "border-cream/50",
                                )}
                              >
                                <span
                                  className={cn("size-2 rounded-full", on ? "bg-gold-deep" : "bg-transparent")}
                                />
                              </span>
                              {v.shortTitle}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {pill("position")}
                    <p id={id("position-help")} className={cn(FIELD_HELP, "px-1.5")}>
                      {vacancy ? vacancy.summary : t.form.position.help}
                    </p>
                  </fieldset>
                </div>

                {/* 02 · You */}
                <div className="relative flex flex-col gap-[22px] border-t border-rust/25 pt-9">
                  <GroupHeading num="02" title={t.form.groups.you} />
                  {textInput("fullName", nameRef, t.form.fullName, {
                    type: "text",
                    autoComplete: "name",
                    maxLength: JOB_LIMITS.fullName * 2,
                  })}
                  {textInput("email", emailRef, t.form.email, {
                    type: "email",
                    inputMode: "email",
                    autoComplete: "email",
                    autoCapitalize: "off",
                    spellCheck: false,
                  })}
                  {textInput("location", locationRef, t.form.location, {
                    type: "text",
                    autoComplete: "address-level2",
                  })}
                </div>

                {/* 03 · Your work */}
                <div className="relative flex flex-col gap-[22px] border-t border-rust/25 pt-9">
                  <GroupHeading num="03" title={t.form.groups.work} />
                  {textInput("linkedinUrl", linkedinRef, t.form.linkedin, {
                    type: "url",
                    inputMode: "url",
                    autoCapitalize: "off",
                    spellCheck: false,
                    optional: true,
                  })}
                  {textInput(
                    "portfolioUrl",
                    portfolioRef,
                    {
                      ...t.form.portfolio,
                      label: vacancy?.portfolioLabel ?? t.form.portfolio.label,
                    },
                    {
                      type: "url",
                      inputMode: "url",
                      autoCapitalize: "off",
                      spellCheck: false,
                      optional: !portfolioRequired,
                    },
                  )}

                  <div className="flex flex-col gap-2.5">
                    <div id={id("socials-label")} className={FIELD_LABEL}>
                      <span>{t.form.socials.label}</span>
                      <span className={OPTIONAL_TAG}>{t.form.optional}</span>
                    </div>
                    <p id={id("socials-help")} className={FIELD_HELP}>
                      {t.form.socials.help}
                    </p>
                    <div
                      role="group"
                      aria-labelledby={id("socials-label")}
                      aria-describedby={describedBy("socials", id("socials-help"))}
                      className="flex flex-col gap-2.5"
                    >
                      {draft.socials.map((row, i) => {
                        const n = i + 1;
                        const rowBad = badRowIds.has(row.id);
                        return (
                          <div key={row.id} className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <label htmlFor={id(`social-platform-${row.id}`)} className="sr-only">
                                {t.form.socials.platform(n)}
                              </label>
                              <div className="relative w-[124px] flex-none sm:w-[168px]">
                                <select
                                  id={id(`social-platform-${row.id}`)}
                                  value={row.platform}
                                  onChange={(e) =>
                                    setSocials((rows) =>
                                      rows.map((r) =>
                                        r.id === row.id
                                          ? { ...r, platform: e.target.value as SocialPlatform }
                                          : r,
                                      ),
                                    )
                                  }
                                  className={cn(shell(false), "h-[52px] cursor-pointer appearance-none pr-9")}
                                >
                                  {SOCIAL_PLATFORMS.map((p) => (
                                    <option key={p} value={p} className="bg-espresso-2 text-cream">
                                      {SOCIAL_PLATFORM_LABELS[p]}
                                    </option>
                                  ))}
                                </select>
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute top-[18px] right-3.5 flex text-cream/60"
                                >
                                  <Icon name="chevron-down" size={16} />
                                </span>
                              </div>
                              <label htmlFor={id(`social-value-${row.id}`)} className="sr-only">
                                {t.form.socials.value(n)}
                              </label>
                              <input
                                ref={(el) => {
                                  if (el) socialInputs.current.set(row.id, el);
                                }}
                                id={id(`social-value-${row.id}`)}
                                type="text"
                                autoCapitalize="off"
                                spellCheck={false}
                                value={row.value}
                                onChange={(e) =>
                                  setSocials((rows) =>
                                    rows.map((r) =>
                                      r.id === row.id ? { ...r, value: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder={t.form.socials.placeholder}
                                aria-invalid={rowBad || undefined}
                                aria-describedby={rowBad ? id(`social-error-${row.id}`) : undefined}
                                className={cn(shell(rowBad), "h-[52px] min-w-0 flex-1")}
                              />
                              <button
                                type="button"
                                onClick={() => removeSocial(row.id)}
                                aria-label={t.form.socials.remove(n)}
                                className="flex size-11 flex-none items-center justify-center rounded-full border border-cream/15 text-cream/75 transition-colors hover:bg-white/[0.06] hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60"
                              >
                                <Icon name="close" size={16} />
                              </button>
                            </div>
                            {rowBad ? (
                              <ErrorPill id={id(`social-error-${row.id}`)}>
                                {t.errors.social}
                              </ErrorPill>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    {pill("socials")}
                    {draft.socials.length < JOB_LIMITS.socials ? (
                      <button
                        ref={addProfileRef}
                        type="button"
                        onClick={addSocial}
                        className="inline-flex h-11 items-center gap-2 self-start rounded-full border border-dashed border-gold/60 pr-[18px] pl-3.5 text-[15px] font-semibold text-gold transition-colors hover:bg-gold/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60"
                      >
                        <Icon name="plus" size={16} />
                        {t.form.socials.add}
                      </button>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label htmlFor={id("message")} className={FIELD_LABEL}>
                      <span>{t.form.about.label}</span>
                    </label>
                    <p id={id("message-help")} className={FIELD_HELP}>
                      {vacancy ? vacancy.aboutHint : t.form.about.help}
                    </p>
                    <textarea
                      ref={messageRef}
                      id={id("message")}
                      rows={7}
                      value={draft.message}
                      onChange={(e) => setField("message", e.target.value)}
                      aria-required
                      aria-invalid={bad("message") || undefined}
                      aria-describedby={describedBy("message", id("message-help"), id("message-count"))}
                      className={cn(
                        shell(bad("message")),
                        "min-h-[176px] resize-y py-3.5 leading-[1.55]",
                      )}
                    />
                    <div className="flex justify-end">
                      <span
                        id={id("message-count")}
                        className={cn(
                          "rounded px-1.5 py-0.5 font-mono text-xs tracking-[0.05em]",
                          messageOver ? "bg-rust/40 text-cream" : "text-cream/60",
                        )}
                      >
                        {format(messageLength)} / {format(JOB_LIMITS.message)}
                        {messageOver
                          ? ` · ${t.form.over(format(messageLength - JOB_LIMITS.message))}`
                          : null}
                      </span>
                    </div>
                    {pill("message")}
                  </div>
                </div>

                {/* 04 · Send */}
                <div className="relative flex flex-col gap-5 border-t border-rust/25 pt-9">
                  <GroupHeading num="04" title={t.form.groups.send} />
                  <div className="flex flex-col gap-1.5">
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 text-[15px] leading-[1.45] text-cream/90">
                      <input
                        ref={ageRef}
                        type="checkbox"
                        checked={draft.ageConfirmed}
                        onChange={(e) => setField("ageConfirmed", e.target.checked)}
                        aria-required
                        aria-invalid={bad("age") || undefined}
                        aria-describedby={describedBy("age")}
                        className="size-5 flex-none cursor-pointer accent-gold"
                      />
                      <span>{t.form.age}</span>
                    </label>
                    {pill("age")}
                  </div>
                  <p className="text-[13px] leading-[1.55] text-cream/70">
                    {t.form.privacy.before}
                    <a
                      href="/privacy#careers"
                      target="_blank"
                      rel="noopener"
                      className={cn(TEXT_LINK, "font-semibold")}
                    >
                      {t.form.privacy.link}
                    </a>
                    {t.form.privacy.after}
                  </p>
                  {summaryShown ? <ErrorPill role="alert">{t.errors.summary}</ErrorPill> : null}
                  {serverPillCopy ? <ErrorPill role="alert">{serverPillCopy}</ErrorPill> : null}
                  <button
                    type="submit"
                    disabled={isPending}
                    className={cn(
                      GOLD_CTA,
                      "w-full gap-2.5 whitespace-nowrap disabled:cursor-progress disabled:opacity-70 xl:h-14",
                    )}
                  >
                    {isPending ? t.form.sending : t.form.submit}
                    {isPending ? null : <Icon name="chevron-right" size={18} />}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* The FAQ — under the form on phones, under the steps on desktop. */}
          {faq ? (
            <div className="order-4 xl:order-none xl:col-start-1 xl:row-start-3">{faq}</div>
          ) : null}
        </div>
      </section>

      {/* Phones only: "We are hiring · Apply" until the form is in view. */}
      <div
        aria-hidden={!barShown}
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-linear-to-t from-espresso/95 from-45% to-transparent px-3 pt-7 pb-[max(env(safe-area-inset-bottom),16px)] transition-[transform,visibility] duration-[260ms] ease-out tablet:hidden",
          barShown ? "visible translate-y-0" : "invisible translate-y-[120%]",
        )}
      >
        <div
          className={cn(
            CARD,
            "pointer-events-auto flex h-16 items-center justify-between gap-3 rounded-full border-rust/35 bg-espresso-2/95 pr-2 pl-5 shadow-sheet",
          )}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-display text-base leading-[1.1] uppercase tracking-[0.1em] text-gold">
              {t.bar.title}
            </span>
            <span className="truncate text-xs leading-[1.3] text-cream/70">{t.bar.sub}</span>
          </div>
          <button
            type="button"
            onClick={goToForm}
            tabIndex={barShown ? undefined : -1}
            className={cn(GOLD_CTA, "h-12 flex-none gap-2 px-[22px]")}
          >
            {t.bar.apply}
            <Icon name="chevron-down" size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
