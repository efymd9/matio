// DRAFT pending legal-counsel review. Describes the cookies the site sets
// (Clerk + Stripe + attribution + Meta Pixel + PostHog + Google Analytics). The
// attribution_first / attribution_last / _fbp / _fbc / ph_* / _ga / _ga_* / __oppref / __oaiq_consent
// marketing cookies are gated on cookie_consent.marketing via proxy.ts + the
// consent banner. Contact details filled 2026-05-27; Meta Pixel + Conversions
// API disclosure added 2026-05-29; PostHog disclosure added 2026-05-30; Google
// Analytics (GA4) disclosure added 2026-06-24. English only since #445
// (2026-10-12): the Spanish version was withdrawn with the site's Spanish (it
// is in git history), and the `locale` row left the table — nothing sets that
// cookie any more. That row changes the English text, hence the new "Last
// updated" (2026-10-12); /terms and /privacy, whose English did not change,
// keep their dates.
// 2026-10-18 edition (#462): the `trial_session` row no longer describes the
// 60-second preview (gone) but what the cookie does now — set by
// /api/playback-token on a free episode's first play, it keys the per-show
// `trial_sessions` record behind anonymous resume (the watch page, the
// Continue watching rail), funnel depth and the sign-up-wall stamp, and the
// link to the account on sign-in (lib/trial.ts). Category kept "Strictly
// necessary", the same footing as `matio_aid` — whether its measurement half
// stands on it is a counsel question (#168). Written by the main session on
// the owner's order (PR #463 thread, 18.10), counsel review pending.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalLink } from "@/components/site/legal-link";
import { isAppEmbed, legalPageRobots } from "@/lib/app-embed-server";
import { getDict } from "@/lib/i18n/server";
import { canonicalUrl } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    title: t.legal.cookiesTitle,
    description: t.legal.cookiesDescription,
    alternates: { canonical: canonicalUrl("/cookies") },
    robots: await legalPageRobots(),
  };
}

const LAST_UPDATED = "October 18, 2026";

export default async function CookiesPage() {
  const { t } = await getDict();
  const embed = await isAppEmbed();
  return (
    <main
      className={
        embed
          ? "bg-background pt-10 pb-16"
          : "bg-background pt-28 pb-24 sm:pt-32"
      }
    >
      <article className="mx-auto max-w-3xl px-6 sm:px-8">
        <header className="mb-10 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
            matio
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-cream sm:text-4xl">
            {t.legal.cookiesTitle}
          </h1>
          <p className="font-mono text-[11px] text-cream/45">
            {t.legal.lastUpdated(LAST_UPDATED)}
          </p>
        </header>
        <CookiesEn />
        {/* No way «home» in the app's embed (#310): home is the full site. */}
        {!embed && (
          <div className="mt-12 border-t border-white/[0.06] pt-6">
            <Link
              href="/"
              className="text-sm font-semibold text-cream/70 transition-colors hover:text-cream"
            >
              ← {t.legal.backHome}
            </Link>
          </div>
        )}
      </article>
    </main>
  );
}

function CookiesEn() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="what" title="1. What cookies are">
        <p>
          Cookies are small text files a website stores on your device so it
          can remember you between visits. Some cookies are essential for the
          site to work; others help us understand how people arrive at the
          site so we can spend our marketing budget sensibly.
        </p>
      </Section>

      <Section id="we-use" title="2. Cookies we use">
        <p>
          The list below covers every cookie this site sets directly or via
          our processors. Categories follow the ePrivacy / GDPR conventions:
          <strong> strictly necessary</strong> cookies don&rsquo;t need
          consent; <strong>marketing</strong> cookies do.
        </p>

        <CookieTable
          rows={[
            {
              name: "__session, __client_uat (Clerk)",
              purpose:
                "Authentication. Keeps you signed in across page loads and lets the server verify your identity.",
              expiry: "Session and short-lived",
              category: "Strictly necessary",
            },
            {
              name: "trial_session",
              purpose:
                "Your viewing of free episodes on this browser. Set when a free episode first plays here, it ties together our first-party record of that viewing for each show: where you stopped, so you can pick up there and find it under Continue watching; how far into the show you got; and whether you reached the sign-up screen. If you then sign up or sign in, it lets us link those records to your account. First-party only — never shared with third parties or used for advertising. A random opaque token: the cookie itself holds nothing about you (what we keep against it is described in section 2 of the Privacy Policy).",
              expiry: "1 year",
              category: "Strictly necessary",
            },
            {
              name: "matio_aid",
              purpose:
                "First-party audience measurement. A random anonymous identifier we use to count unique visitors and which pages were viewed (home page, show pages, sign-up wall). First-party only — never shared with third parties, never used for advertising or cross-site tracking — so it needs no consent.",
              expiry: "13 months (not refreshed)",
              category: "Strictly necessary",
            },
            {
              name: "__stripe_mid, __stripe_sid (Stripe)",
              purpose:
                "Anti-fraud fingerprinting on Stripe Checkout pages. Set by Stripe directly when you start a checkout.",
              expiry: "Up to 1 year",
              category: "Strictly necessary",
            },
            {
              name: "attribution_first",
              purpose:
                "First UTM source / medium / campaign you arrived from. Used to attribute paid signups to the campaign that originally introduced you to matio.",
              expiry: "90 days",
              category: "Marketing",
            },
            {
              name: "attribution_last",
              purpose:
                "Most recent UTM source / medium / campaign. Used to reconcile our attribution against ad-platform dashboards.",
              expiry: "30 days",
              category: "Marketing",
            },
            {
              name: "_fbp (Meta)",
              purpose:
                "Set by the Meta Pixel to identify your browser for advertising measurement and to attribute conversions to our Meta ad campaigns. Only set after you accept marketing cookies.",
              expiry: "90 days",
              category: "Marketing",
            },
            {
              name: "_fbc / fbclid (Meta)",
              purpose:
                "Stores the Meta click identifier when you arrive from a Facebook or Instagram ad, so a later sign-up or subscription can be matched to that ad. Only used after you accept marketing cookies.",
              expiry: "90 days",
              category: "Marketing",
            },
            {
              name: "muxData / mux_viewer_id (Mux)",
              purpose:
                "Set by Mux Data (our video provider’s analytics) to measure watch time, unique viewers and playback quality. Only used after you accept marketing cookies.",
              expiry: "Up to 1 year",
              category: "Marketing",
            },
            {
              name: "ph_* (PostHog)",
              purpose:
                "Set by PostHog, our product-analytics tool, to identify your browser session and measure how visitors move through the site (funnel analytics, page views, feature interactions). Session replays and heatmaps are also recorded with all inputs and text masked. Only set after you accept marketing cookies.",
              expiry: "Up to 1 year",
              category: "Marketing",
            },
            {
              name: "_ga, _ga_* (Google)",
              purpose:
                "Set by Google Analytics (GA4) to distinguish your browser and measure site traffic, page views and how visitors use the site. Only set after you accept marketing cookies.",
              expiry: "Up to 2 years",
              category: "Marketing",
            },
            {
              name: "__oppref, __oaiq_consent (OpenAI)",
              purpose:
                "Set by the ChatGPT Ads measurement pixel (OpenAI) to store the click identifier when you arrive from an ad shown in ChatGPT, so a later sign-up can be attributed to that ad, and to remember your consent choice for it. Only set after you accept marketing cookies.",
              expiry: "Consent choice: 30 days; click id: set by OpenAI",
              category: "Marketing",
            },
          ]}
        />
        <p>
          We use the <strong>Meta Pixel</strong> and Meta&rsquo;s{" "}
          <strong>Conversions API</strong> to measure how our advertising on
          Facebook and Instagram performs. These run{" "}
          <strong>only after you accept marketing cookies</strong> in the
          banner. When active they share a limited set of data with{" "}
          <strong>Meta Platforms Ireland Ltd</strong> &mdash; a hashed
          (SHA-256) version of your email address, your IP address, and event
          signals such as page views, sign-ups and subscriptions. We also use{" "}
          <strong>Google Analytics</strong> (GA4) to measure site traffic and
          how visitors use the site. It runs{" "}
          <strong>only after you accept marketing cookies</strong> &mdash; until
          then Google&rsquo;s consent-mode signals are withheld &mdash; and
          shares usage and device data with <strong>Google Ireland Ltd</strong>.
          We also use the <strong>ChatGPT Ads measurement pixel</strong> to
          measure how our advertising in ChatGPT performs; it runs{" "}
          <strong>only after you accept marketing cookies</strong> and shares
          event signals (page views, sign-ups) with{" "}
          <strong>OpenAI Ireland Ltd</strong>.
          Our video provider <strong>Mux</strong> measures
          playback quality and watch time via <strong>Mux Data</strong>; like
          the Pixel, this runs <strong>only after you accept marketing
          cookies</strong> and sets a viewer identifier so we can count unique
          viewers. We also use <strong>PostHog</strong> (EU Cloud) for
          product analytics &mdash; measuring which steps of the sign-up
          funnel visitors reach and where they drop off. PostHog loads{" "}
          <strong>only after you accept marketing cookies</strong>, with
          autocapture disabled, session replay fully masked, and data
          processed on servers in the European Union (PostHog Cloud EU).
        </p>
      </Section>

      <Section id="manage" title="3. How to manage cookies">
        <p>
          In the EU, EEA, UK and Switzerland, marketing cookies are set{" "}
          <strong>only after you accept</strong> them in the banner. Elsewhere
          (where the law allows) they may be enabled by default &mdash; in
          either case you can <strong>turn them off at any time</strong>.
        </p>
        <p>
          You can refuse or withdraw your consent for non-essential cookies at
          any time through our cookie banner — reopen it whenever you like from
          the &ldquo;Cookie preferences&rdquo; link in the site footer.
        </p>
        <p>
          You can also delete cookies directly from your browser settings.
          Strictly-necessary cookies will be re-set on your next visit because
          the service can&rsquo;t function without them.
        </p>
      </Section>

      <Section id="changes" title="4. Changes to this policy">
        <p>
          We may update this Cookie Policy as we add or remove processors.
          The current version is dated above.
        </p>
      </Section>

      <Section id="contact" title="5. Contact">
        <p>
          Cookie questions: <strong>maksym@matio.tv</strong>. See also our{" "}
          <LegalLink href="/privacy" className="underline underline-offset-2 hover:text-white">
            Privacy Policy
          </LegalLink>{" "}
          and{" "}
          <LegalLink href="/terms" className="underline underline-offset-2 hover:text-white">
            Terms of Service
          </LegalLink>
          .
        </p>
      </Section>
    </div>
  );
}

function CookieTable({
  rows,
}: {
  rows: { name: string; purpose: string; expiry: string; category: string }[];
}) {
  return (
    <div className="-mx-1 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-white/45">
            <th className="px-3 py-2 text-left font-semibold">Cookie</th>
            <th className="px-3 py-2 text-left font-semibold">Purpose</th>
            <th className="px-3 py-2 text-left font-semibold">Expiry</th>
            <th className="px-3 py-2 text-left font-semibold">Category</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-white/[0.05] align-top">
              <td className="px-3 py-3 font-mono text-xs text-white">{r.name}</td>
              <td className="px-3 py-3 text-white/70">{r.purpose}</td>
              <td className="px-3 py-3 text-white/70">{r.expiry}</td>
              <td className="px-3 py-3 text-white/70">{r.category}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3 scroll-mt-24">
      <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
