// DRAFT pending legal-counsel review. Trading party + contact details
// filled 2026-05-27; entity updated 2026-08-16; §5 price rewritten 2026-09-09 (#208) — visible "Last updated" set to that edition in #214 (DEEP ORDINARY LTD, England
// & Wales). The Stripe Checkout consent_collection.terms_of_service flow
// (digital-content waiver, §6) is wired in app/subscribe/actions.ts. English
// only since #445 (2026-10-12): the Spanish version was withdrawn with the
// site's Spanish — it is in git history.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalLink } from "@/components/site/legal-link";
import { isAppEmbed, legalPageRobots } from "@/lib/app-embed-server";
import { paymentsEnabled } from "@/lib/free-mode";
import { getDict } from "@/lib/i18n/server";
import { canonicalUrl } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    title: t.legal.termsTitle,
    description: t.legal.termsDescription,
    alternates: { canonical: canonicalUrl("/terms") },
    robots: await legalPageRobots(),
  };
}

const LAST_UPDATED = "October 12, 2026";

export default async function TermsPage() {
  const { t } = await getDict();
  const embed = await isAppEmbed();
  // Free pivot: with payments off, §4 (60s preview) and §5-6 (pricing /
  // billing / withdrawal) describe a purchase flow that doesn't currently
  // exist. The legal wording below stays untouched (counsel-pending, and it
  // still governs memberships bought before the pivot) — this notice frames
  // it so the indexed page doesn't sell "$1 today" as a current fact.
  const paymentsOn = paymentsEnabled();
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
            {t.legal.termsTitle}
          </h1>
          <p className="font-mono text-[11px] text-cream/45">
            {t.legal.lastUpdated(LAST_UPDATED)}
          </p>
        </header>
        {!paymentsOn && (
          <div className="mb-10 rounded-lg border border-white/[0.12] bg-white/[0.04] p-4 text-sm leading-relaxed text-white/75">
            <strong>Notice:</strong> payments are currently disabled on
            matio — all content is free to watch and no new subscriptions
            or trials can be purchased. The preview, pricing and billing
            sections below apply only while payments are enabled and to
            memberships purchased before this change; existing memberships
            can still be managed and cancelled via the Stripe Customer
            Portal.
          </div>
        )}
        <TermsEn />
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

function TermsEn() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="acceptance" title="1. Acceptance of these terms">
        <p>
          These Terms of Service (the &ldquo;Terms&rdquo;) form a binding agreement
          between you and DEEP ORDINARY LTD (&ldquo;matio&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;), registered in England and Wales (company
          no.&nbsp;17381666), registered office: 66 Paul Street, London
          EC2A&nbsp;4NA, United Kingdom. By creating an account
          or paying for a subscription, you confirm you have read, understood and
          accept these Terms. If you do not accept them, do not use the service.
        </p>
        <p>
          You must be at least 16 years old to create an account. If you are
          younger, a parent or legal guardian must agree on your behalf.
        </p>
      </Section>

      <Section id="service" title="2. The service">
        <p>
          matio is a subscription video streaming service offering original
          short-form content (&ldquo;Content&rdquo;) at <strong>matio.tv</strong> and
          successor domains. Access is provided over the public internet on
          supported browsers and devices. We may add, change or remove Content
          at any time at our editorial discretion.
        </p>
      </Section>

      <Section id="account" title="3. Your account">
        <p>
          We use Clerk to handle sign-up and sign-in. You are responsible for
          keeping your sign-in credentials confidential and for everything that
          happens under your account. Notify us immediately if you suspect
          unauthorised use.
        </p>
      </Section>

      <Section id="trial" title="4. Free preview">
        <p>
          Each show offers a free 60-second preview per browser session, with no
          account required. We use a HTTP-only cookie and an HMAC-hashed IP
          address to limit previews to three per network per hour, to prevent
          the preview becoming a substitute for the paid service. The preview is
          a marketing courtesy and may be removed or changed without notice.
        </p>
      </Section>

      <Section id="subscription" title="5. Subscription, price and renewal">
        <p>
          Membership costs <strong>USD $25 per month</strong>, charged today
          and then automatically each month until cancelled, plus any VAT,
          sales tax or other indirect tax that applies in your billing country
          (calculated automatically by Stripe Tax at checkout). There is no
          trial period and no separate introductory fee.
        </p>
        <p>
          You can cancel at any time from the Stripe Customer Portal — accessible
          from the &ldquo;Manage subscription&rdquo; menu — and your cancellation
          takes effect at the end of the current paid period. We do not refund
          partial months. If a payment fails we retry it, and access may be
          paused or cancelled if the issue is not resolved.
        </p>
        <p>
          We may change the price or the plan structure. We will give you at
          least 30 days&rsquo; advance notice by email, and any change applies
          from the next renewal — you can cancel before then if you do not
          accept the new terms.
        </p>
      </Section>

      <Section id="withdrawal" title="6. Digital content — right of withdrawal">
        <p>
          The matio service is digital content supplied immediately upon
          subscription. By subscribing, <strong>you expressly request that we
          begin supply immediately and you acknowledge that you lose your
          14-day statutory right of withdrawal once playback begins</strong>{" "}
          (Article 16(m) of EU Directive 2011/83/EU and equivalent UK
          regulations). If you are an EU or UK consumer, you must tick the
          consent box at checkout to confirm this; without that consent, the
          subscription cannot start.
        </p>
      </Section>

      <Section id="licence" title="7. Licence and acceptable use">
        <p>
          As long as your subscription is active, we grant you a personal,
          non-transferable, non-exclusive, revocable licence to stream Content
          on your devices for private, non-commercial use.
        </p>
        <p>You agree not to:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>download, copy, screen-record, transcode, scrape or distribute Content;</li>
          <li>defeat or attempt to defeat any access control, watermark, token or technical protection;</li>
          <li>share your account, password or session with anyone;</li>
          <li>use the service to operate any commercial broadcast or public performance;</li>
          <li>use bots, automated tools or load-testing against the service.</li>
        </ul>
        <p>
          We may suspend or terminate access if we reasonably believe you have
          breached these Terms.
        </p>
      </Section>

      <Section id="content-ip" title="8. Intellectual property">
        <p>
          All Content, software, design, trademarks and other material on the
          service are owned by matio or our licensors and protected by copyright
          and other intellectual-property laws. Nothing in these Terms transfers
          any of those rights to you.
        </p>
      </Section>

      <Section id="payments" title="9. Payments and Stripe">
        <p>
          Payments are processed by Stripe Payments Europe Ltd and its
          affiliates. By subscribing you also accept Stripe&rsquo;s applicable
          payer terms. We do not see or store your full payment-card details.
        </p>
      </Section>

      <Section id="warranty" title="10. Disclaimer of warranties">
        <p>
          The service is provided <em>as is</em> and <em>as available</em>. To
          the maximum extent permitted by law, we disclaim implied warranties of
          merchantability, fitness for a particular purpose and non-infringement.
          We do not promise uninterrupted availability, that any specific
          Content will remain available, or that the service will be free of
          defects or errors. Nothing in these Terms limits any rights you have
          as a consumer that cannot be limited or excluded by applicable law.
        </p>
      </Section>

      <Section id="liability" title="11. Limitation of liability">
        <p>
          To the maximum extent permitted by law, our total aggregate liability
          arising out of or related to these Terms or the service is limited to
          the greater of (a) the amount you paid us in the 12 months before the
          event that gave rise to the claim, or (b) USD $100. We are not liable
          for indirect, incidental, consequential or punitive damages, loss of
          profits, loss of data, or loss of business opportunity. None of this
          excludes liability for death, personal injury caused by negligence,
          fraud, or any other liability that cannot be excluded under
          applicable law.
        </p>
      </Section>

      <Section id="termination" title="12. Termination">
        <p>
          You can stop using the service at any time. We may suspend or
          terminate your access if you breach these Terms, or for legal,
          regulatory or operational reasons. On termination, sections 7
          (Licence), 8 (IP), 10 (Disclaimer), 11 (Liability), 13 (Governing law)
          and any others that should reasonably survive will continue to apply.
        </p>
      </Section>

      <Section id="law" title="13. Governing law and disputes">
        <p>
          These Terms are governed by the laws of England and Wales. The courts of
          England and Wales have exclusive jurisdiction over disputes, except that
          consumers may rely on mandatory protections of the law of their
          habitual residence. You can also use the European Commission&rsquo;s
          online dispute-resolution platform at{" "}
          <a
            href="https://ec.europa.eu/consumers/odr"
            className="underline underline-offset-2 hover:text-white"
          >
            ec.europa.eu/consumers/odr
          </a>
          .
        </p>
      </Section>

      <Section id="changes" title="14. Changes to these terms">
        <p>
          We may update these Terms. If a change is material we will give
          reasonable notice (typically by email and a banner on the service).
          Continued use after a change takes effect counts as acceptance.
        </p>
      </Section>

      <Section id="contact" title="15. Contact">
        <p>
          Questions about these Terms or the service: <strong>maksym@matio.tv</strong>.
          See also the <LegalLink href="/privacy" className="underline underline-offset-2 hover:text-white">Privacy Policy</LegalLink>{" "}
          and{" "}
          <LegalLink href="/cookies" className="underline underline-offset-2 hover:text-white">Cookie Policy</LegalLink>.
        </p>
      </Section>
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
