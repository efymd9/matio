// DRAFT pending legal-counsel review (esp. Art. 13/14 UK GDPR disclosures
// + retention periods). Controller details filled 2026-05-27 (DEEP
// ORDINARY LTD, company no. 17381666, UK). No DPO appointed (not required
// under Art. 37). Supervisory authorities named inline: AEPD (ES) / ICO (UK).
// PostHog disclosure added 2026-05-30. Google Analytics (GA4) disclosure
// added 2026-06-24. §11 «Our mobile app» added 2026-09-27 (#312, App Store
// 5.1.1(i) + art. 13): drafted by an agent from the code, merged on the
// owner's approval in the PR thread, counsel review pending with the rest of
// this page (#168); "Contact" moved from §11 to §12 — §1–§10 keep their
// numbers (lib/retention.ts cites §6).
// Story ideas (/ideas, #297) added 2026-09-27 in §2/§3/§4/
// §6/§7/§8 — same DRAFT status (counsel questions: #168). Sign-in with
// Google / Apple (#277) added 2026-10-04 in §2, §4 and §11: an agent's draft,
// merged only on the owner's «да» in the PR thread, counsel review pending
// with the rest (#168). §3's marketing-measurement basis (#342) rewritten
// 2026-10-09 to say what lib/cookie-consent.ts + proxy.ts do — consent via
// the banner in the EU/EEA, UK and CH, on by default with the footer opt-out
// elsewhere — worded like the §2 ideas item: an agent's draft, merged only
// on the owner's «да» in the PR thread; the counsel question is in #168.
// §3 (#420) 2026-10-11: Mux Data moved out of the legitimate-interests
// "improve the service" item into that marketing-measurement item (both
// players run it only with marketing consent — lib/use-marketing-consent.ts,
// as /cookies §2 says), and the ChatGPT Ads pixel named there: an agent's
// draft, merged only on the owner's «да» in the PR thread; who OpenAI is to
// us (§4) is the counsel's question in #168, p. 8. In the same draft (#443):
// §2 «Marketing-attribution data» names the same tools and the same geo rule
// as §3, and the §4 Meta / PostHog / Google rows plus Mux (now with Mux Data)
// say that rule instead of «after you accept» to everyone.
// English only since #445 (2026-10-12): the Spanish version was withdrawn
// with the site's Spanish — it is in git history. Not a new edition: the
// English text did not change, so "Last updated" stays at 2026-10-11.
// Job applications (/careers, #376) added 2026-10-15 in §2/§3/§6/§8 — a new
// edition ("Last updated" moves): an agent's draft from the code, DRAFT with
// the rest of this page; the lawful-basis choice is the counsel's question
// (#168). §3 says what the analytics sees of an application (the PostHog
// `job_application_submitted {position}` count, marketing cookies only), and
// §4's mailbox row names Google Workspace, which has carried maksym@matio.tv
// since 08.10.2026 (#414), instead of Namecheap PrivateEmail — both in the
// same #376 draft, merged on the owner's «да» in the PR thread.
// 2026-10-18 edition (#462): the 60-second preview is gone. §2 "Usage data"
// describes the anonymous free-episode record instead — every field
// `trial_sessions` holds for a web row (db/schema/trial_sessions.ts; the
// `expires_at` column is the creation time for these rows, lib/trial.ts) and
// the cookie + 6-hour same-network links of linkTrialSessionsToCurrentUser —
// and §11 drops "when a free preview expires" and the preview as a viewing
// rule (no access decision reads the record any more; what it still backs
// is the anonymous counters' proof of playback, lib/watch-segments-write.ts).
// Written by the main session on the owner's order (PR #463 thread, 18.10),
// counsel review pending with the rest of the page (#168).
// matio.tv/ideas is
// plain text on purpose: every internal link here must survive ?embed=app
// (app/(public)/legal-embed.test.tsx).
import type { Metadata } from "next";
import Link from "next/link";
import { LegalLink } from "@/components/site/legal-link";
import { isAppEmbed, legalPageRobots } from "@/lib/app-embed-server";
import { getDict } from "@/lib/i18n/server";
import { canonicalUrl } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    title: t.legal.privacyTitle,
    description: t.legal.privacyDescription,
    alternates: { canonical: canonicalUrl("/privacy") },
    robots: await legalPageRobots(),
  };
}

const LAST_UPDATED = "October 18, 2026";

export default async function PrivacyPage() {
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
            {t.legal.privacyTitle}
          </h1>
          <p className="font-mono text-[11px] text-cream/45">
            {t.legal.lastUpdated(LAST_UPDATED)}
          </p>
        </header>
        <PrivacyEn />
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

function PrivacyEn() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="controller" title="1. Who we are">
        <p>
          DEEP ORDINARY LTD, registered in England and Wales (company
          no.&nbsp;17381666, registered office: 66 Paul Street, London
          EC2A&nbsp;4NA), is the data controller for the personal data processed through{" "}
          <strong>matio.tv</strong>. You can reach us at{" "}
          <strong>maksym@matio.tv</strong>. Our data-protection contact is
          the same address. We have not appointed a Data Protection Officer
          and are not required to under Article 37 UK GDPR.
        </p>
      </Section>

      <Section id="data" title="2. What we collect">
        <p>We process the following categories of personal data:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Account data</strong> — email address, name (if you give
            one), authentication tokens. Collected and stored by Clerk on our
            behalf. We also mirror a minimal user record (Clerk id, email,
            role) in our own database to power authorisation. If you sign in
            with Google or Apple, we receive from that provider, through
            Clerk, what you choose to share with us: your email address (with
            Apple, possibly a private relay address that forwards to your real
            one), your name and, from Google, your profile picture, together
            with the provider&rsquo;s identifier for your account. Clerk keeps
            them with your account.
          </li>
          <li>
            <strong>Subscription and payment data</strong> — billing name and
            address (required for VAT calculation), payment method, invoice
            history, subscription status, period end. Collected and stored by
            Stripe on our behalf. We never see your full card number; we only
            receive a Stripe customer reference and a redacted last-four.
          </li>
          <li>
            <strong>Usage data</strong> — which episodes you watched and the
            playback position, recorded per (user, episode) so you can resume.
            When a free episode plays on your browser, we may also keep one
            record per show for that browser, identified by the random token
            in the{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">trial_session</code>{" "}
            cookie: the show, when the record was created, the last free
            episode you watched and how far into it you got, the furthest
            episode you reached in that show, when you first reached the
            sign-up screen, a keyed hash (HMAC) of your IP address — for an
            IPv6 address, of its network prefix — (the raw IP is never
            stored), whether the record came from the website or the app, and
            the campaign source / medium / campaign that brought you, only
            while marketing cookies are on. If you then sign in on that
            browser, the record is linked to your account — and so may be
            website records created from the same internet connection in the
            six hours before — and if that account later subscribes, the
            record is marked as converted. Unlinked records are kept as
            described under &ldquo;Trial sessions&rdquo; in section 6. The app
            keeps the same kind of record against its device identifier
            (section 11).
          </li>
          <li>
            <strong>Marketing-attribution data</strong> — if you arrive from a
            campaign URL we record the source / medium / campaign in two cookies
            and may attach the snapshot to your account at checkout for revenue
            attribution. While marketing cookies are on, we also run the Meta
            Pixel and Meta Conversions API for advertising measurement (sharing a
            hashed email address, IP address and conversion events with Meta),
            PostHog for product analytics (funnel and engagement events, masked
            session replays, processed in the EU), Google Analytics (GA4) for
            site-traffic measurement, the ChatGPT Ads measurement pixel
            (ChatGPT ad measurement), and Mux Data (watch-time and
            playback-quality measurement by our video provider, Mux). In the
            EU/EEA, the UK and Switzerland, marketing cookies are on only after
            you accept them in the banner; elsewhere they are on by default and
            you can switch them off under &ldquo;Cookie preferences&rdquo; in
            the footer.
            See the <LegalLink href="/cookies" className="underline underline-offset-2 hover:text-white">Cookie Policy</LegalLink>.
          </li>
          <li>
            <strong>First-party audience measurement</strong> — a strictly
            first-party cookie (<code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">matio_aid</code>)
            holding a random anonymous identifier lets us measure our own
            audience: the days you visited, which pages you viewed (home page,
            show pages, the sign-up wall), the marketing source / medium /
            campaign and referrer of your first visit, and the country your
            visit came from (derived from your IP — the raw IP address is never
            stored against it). This is never shared with third parties and
            never used for advertising or cross-site tracking. If you later
            create an account, the identifier is linked to it so we can join
            that first visit to your sign-up. You can delete the cookie at any
            time in your browser settings.
          </li>
          <li>
            <strong>Communications</strong> — emails you send us, support
            conversations, and transactional email such as the new-episode
            notifications you ask for.
          </li>
          <li id="ideas" className="scroll-mt-24">
            <strong>Story ideas</strong> — if you send us an idea through
            matio.tv/ideas, we keep the idea itself (the series it continues
            or that it is a new one, the working title, the logline and the
            story), the name or pen name you give us and your email address;
            whether you asked for emails about new episodes and story calls,
            the version of the Idea Submission Terms you accepted, and the
            site language; and the campaign that brought you, only while
            marketing cookies are on — in the EU/EEA, the UK and Switzerland
            after you accept them in the banner; elsewhere they are on by
            default and you can switch them off under &ldquo;Cookie
            preferences&rdquo; in the footer. You don&rsquo;t need an account
            to send an idea, and we don&rsquo;t store your IP address with it.
          </li>
          <li id="careers" className="scroll-mt-24">
            <strong>Job applications</strong> — if you apply for a role
            through matio.tv/careers, we keep the role you applied for, your
            full name, your email address, where you are based, the links you
            give us (LinkedIn, a portfolio or other work, and up to four
            social profiles — a link or an @handle) and what you write about
            yourself. You don&rsquo;t need an account to apply, we don&rsquo;t
            accept files, and we don&rsquo;t store your IP address with your
            application.
          </li>
          <li>
            <strong>Technical data</strong> — IP address, browser user-agent,
            request logs needed to operate, secure and debug the service.
            Held for up to 30 days.
          </li>
        </ul>
      </Section>

      <Section id="purposes" title="3. Why we use it (lawful bases)">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>To deliver the service to you</strong> (account, playback,
            subscription billing). Lawful basis: <em>performance of the contract</em>{" "}
            you enter into when you subscribe.
          </li>
          <li>
            <strong>To meet our legal obligations</strong> (VAT/tax records,
            consumer-rights compliance, anti-fraud, replying to lawful requests
            from authorities). Lawful basis: <em>legal obligation</em>.
          </li>
          <li>
            <strong>To keep the service secure</strong> (rate-limit abuse,
            detect fraud, debug). Lawful basis: <em>legitimate interests</em> —
            operating a stable, safe service.
          </li>
          <li>
            <strong>To improve the service</strong> (aggregate analytics).
            Lawful basis: <em>legitimate interests</em>.
          </li>
          <li>
            <strong>To review a story idea you send us</strong>, contact you
            about it and keep a record of the licence you grant. Lawful basis:{" "}
            <em>performance of a contract</em> — the Idea Submission Terms you
            accept when you send it. <strong>Emails about new episodes and
            story calls</strong>: lawful basis <em>consent</em>, only if you
            tick the box; we don&rsquo;t send them yet.
          </li>
          <li>
            <strong>To consider your job application</strong> and contact
            you about it. Lawful basis: <em>steps taken at your request
            before entering into a contract</em> and our{" "}
            <em>legitimate interests</em> in recruiting for Matio. We use your
            application for nothing else. While marketing cookies are on, our
            product analytics (PostHog) also counts that an application for a
            role was sent — which role, never your name, your contact details,
            your links or what you wrote.
          </li>
          <li>
            <strong>Marketing and advertising measurement</strong> via the{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_first</code>{" "}
            and{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_last</code>{" "}
            cookies and, where enabled, the Meta Pixel, Meta Conversions API,
            PostHog (product-analytics funnel measurement), Google Analytics
            (site-traffic measurement), the ChatGPT Ads measurement pixel
            (ChatGPT ad measurement), and Mux Data (watch-time and
            playback-quality measurement by our video provider, Mux).
            Lawful basis in the EU/EEA, the UK and Switzerland:{" "}
            <em>consent</em> — there these run only after you accept marketing
            cookies in the banner, and stop if you withdraw consent. Elsewhere
            they are on by default, and you can switch them off under
            &ldquo;Cookie preferences&rdquo; in the footer.
          </li>
          <li>
            <strong>First-party audience measurement</strong> (counting unique
            visitors and understanding which pages are used, via the{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">matio_aid</code>{" "}
            cookie). Lawful basis: <em>legitimate interests</em> — understanding
            how our own service is used without third-party tracking. Because
            this measurement stays strictly first-party and is never used for
            advertising, it does not require consent.
          </li>
        </ul>
      </Section>

      <Section id="sharing" title="4. Who we share data with">
        <p>
          We rely on third-party processors who handle data on our instructions.
          The current subprocessor list:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Clerk Inc.</strong> (US) — authentication. EU/UK transfers
            covered by Standard Contractual Clauses (SCCs).
          </li>
          <li>
            <strong>Stripe Payments Europe Ltd</strong> (Ireland) — payments and
            billing. Stripe may transfer some data to its US affiliates under
            SCCs.
          </li>
          <li>
            <strong>Mux Inc.</strong> (US) — video transcoding, storage and
            signed playback, and playback measurement (Mux Data: watch time and
            playback quality). Mux Data is only engaged while marketing cookies
            are on: in the EU/EEA, the UK and Switzerland after you accept them
            in the banner; elsewhere by default, until you switch them off
            under &ldquo;Cookie preferences&rdquo; in the footer. SCCs.
          </li>
          <li>
            <strong>Vercel Inc.</strong> (US, EU regions for compute) — hosting.
            Our application functions run in Frankfurt (eu-central-1); the CDN
            is global. SCCs.
          </li>
          <li>
            <strong>Neon Inc.</strong> (US, EU region for our database) — our
            Postgres database is hosted on AWS Frankfurt (eu-central-1). SCCs.
          </li>
          <li>
            <strong>Resend Inc.</strong> (US, EU region for email delivery) —
            transactional email: the new-episode notifications you ask for.
            We share the email address you submitted and the show it relates
            to; every email carries an unsubscribe link. SCCs.
          </li>
          <li>
            <strong>Meta Platforms Ireland Ltd</strong> (Ireland, with
            transfers to Meta Platforms Inc. in the US) — advertising
            measurement via the Meta Pixel and Conversions API. Only engaged
            while marketing cookies are on: in the EU/EEA, the UK and
            Switzerland after you accept them in the banner; elsewhere by
            default, until you switch them off under &ldquo;Cookie
            preferences&rdquo; in the footer. We share a hashed (SHA-256)
            email address, IP address and conversion events so Meta can
            attribute and optimise our ad campaigns. US transfers covered by
            SCCs.
          </li>
          <li>
            <strong>PostHog Inc.</strong> (US, EU Cloud region for our project)
            — product analytics. Our PostHog project is hosted on PostHog&rsquo;s
            EU Cloud (servers in the European Union), so behavioral and usage
            data stays in the EU. Only engaged while marketing cookies are on:
            in the EU/EEA, the UK and Switzerland after you accept them in the
            banner; elsewhere by default, until you switch them off under
            &ldquo;Cookie preferences&rdquo; in the footer.
            We send funnel events (page views, feature interactions, sign-up
            steps) and masked session replays. SCCs cover any onward transfers to
            PostHog&rsquo;s US infrastructure.
          </li>
          <li>
            <strong>Google Ireland Ltd</strong> (Ireland, with transfers to
            Google LLC in the US) — site analytics via Google Analytics 4. Only
            engaged while marketing cookies are on: in the EU/EEA, the UK and
            Switzerland after you accept them in the banner; elsewhere by
            default, until you switch them off under &ldquo;Cookie
            preferences&rdquo; in the footer. We share usage and device
            data (page views, approximate location from IP, browser/device
            details) so we can measure site traffic. US transfers covered by SCCs.
          </li>
          <li>
            <strong>Google and Apple</strong> — only if you choose to sign in
            with them. Google (Google Ireland Ltd and Google LLC) or Apple
            (Apple Distribution International Ltd and Apple Inc.) learns that
            you signed in to Matio and passes us, through Clerk, the details
            described in section 2. They are not our processors: each acts as
            the independent controller of your Google or Apple account, under
            its own privacy policy.
          </li>
          <li>
            <strong>Production partners</strong> — only for an idea we develop
            with you, and only what the production needs.
          </li>
          <li>
            <strong>Google Ireland Ltd</strong> (Google Workspace, with
            transfers to Google LLC in the US) — our mailbox at
            maksym@matio.tv, for correspondence with you, including replies
            about story ideas and job applications and requests about your
            data. SCCs.
          </li>
        </ul>
        <p>
          We do not sell your personal data. We may disclose information when
          required by law, to enforce these terms, or to protect rights, safety
          or property.
        </p>
      </Section>

      <Section id="transfers" title="5. International transfers">
        <p>
          Some of the processors above are established in the United States.
          Where personal data leaves the EEA / UK, we rely on the European
          Commission&rsquo;s Standard Contractual Clauses and, where relevant,
          the UK International Data Transfer Addendum. Stripe is established
          in Ireland and processes most billing data in the EU.
        </p>
      </Section>

      <Section id="retention" title="6. How long we keep it">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Account</strong>: while your account exists, plus a short
            grace period after deletion.
          </li>
          <li>
            <strong>Payment and tax records</strong>: kept for as long as
            required by tax and accounting law (typically 6–10 years depending
            on jurisdiction).
          </li>
          <li>
            <strong>Watch progress</strong>: kept while the account exists.
          </li>
          <li>
            <strong>Trial sessions</strong>: retained for 30 days for abuse
            analytics, then deleted or fully anonymised.
          </li>
          <li>
            <strong>Audience-measurement data</strong>: the first-party
            audience identifier and the data recorded against it are kept for
            up to 25 months, then deleted or fully anonymised.
          </li>
          <li>
            <strong>Story ideas</strong>: up to 24 months from submission, or
            longer only if we develop your idea with you.
          </li>
          <li>
            <strong>Job applications</strong>: 6 months from submission.
          </li>
          <li>
            <strong>Request and security logs</strong>: 30 days.
          </li>
        </ul>
      </Section>

      <Section id="rights" title="7. Your rights">
        <p>
          You have the right to access, rectify, erase, restrict, port and
          object to the processing of your personal data, and to withdraw any
          consent you have given (e.g. by clearing marketing cookies in the
          cookie banner). To exercise these rights, contact us at{" "}
          <strong>maksym@matio.tv</strong>. We will respond within 30 days.
        </p>
        <p>
          You can withdraw your consent to emails about new episodes and story
          calls at any time by writing to <strong>maksym@matio.tv</strong> or
          through the &ldquo;unsubscribe&rdquo; link in any email we send you.
        </p>
        <p>
          If you believe we have not handled your data correctly, you can lodge
          a complaint with your supervisory authority. In Spain that is the
          Agencia Española de Protección de Datos (AEPD,{" "}
          <a href="https://www.aepd.es" className="underline underline-offset-2 hover:text-white">
            aepd.es
          </a>
          ). In the UK that is the Information Commissioner&rsquo;s Office
          (ICO,{" "}
          <a href="https://ico.org.uk" className="underline underline-offset-2 hover:text-white">
            ico.org.uk
          </a>
          ). Your local authority elsewhere in the EEA is equally competent.
        </p>
      </Section>

      <Section id="children" title="8. Children">
        <p>
          The service is intended for users aged 16 and over. We do not
          knowingly collect personal data from children below that age. If we
          learn we have, we will delete it. Story ideas and job applications
          may only be sent by people aged 18 or over.
        </p>
      </Section>

      <Section id="security" title="9. Security">
        <p>
          We take appropriate technical and organisational measures to protect
          your data: TLS everywhere, encrypted-at-rest databases, scoped
          credentials, signed playback tokens, webhook signature verification,
          and least-privilege access controls. No system is completely secure;
          if a personal-data breach is likely to affect you, we will notify
          you and the relevant authority as required by law.
        </p>
      </Section>

      <Section id="changes" title="10. Changes to this policy">
        <p>
          We may update this Privacy Policy. If a change is material we will
          give reasonable notice (typically by email and a banner on the
          service).
        </p>
      </Section>

      {/* DRAFT (#312) — see the note at the top of the file. Each sentence
          is tied to the code in #312's PR; the data map
          (.claude/skills/gdpr/references/data-map.md) says the same. */}
      <Section id="app" title="11. Our mobile app">
        <p>
          This section covers the Matio app for phones. The rest of this
          policy applies to the app too, except the website&rsquo;s cookies
          and the tools that depend on them, which the app does not use.
          Below is what the app adds.
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Device identifier</strong> — the first time the app
            contacts our servers, it creates a random identifier (a UUID) that
            contains nothing about you or your device. It keeps the identifier
            in the device&rsquo;s secure storage — on iPhone, the keychain,
            where the app can read it once the phone has been unlocked after
            being switched on, so that playback can continue with the screen
            locked — and sends it with every request to our servers. On iPhone
            the keychain can keep the identifier after the app is deleted, so
            reinstalling the app may bring back the same identifier; on
            Android it is normally removed together with the app. Signing in
            in the app does not link the identifier to your account (for the
            one way a record kept against it can become linked, see &ldquo;How
            long we keep it&rdquo; below).
          </li>
          <li>
            <strong>What the identifier is used for</strong> — when a free
            episode plays, we may keep one record per show against the
            identifier: the show, when playback started, when the sign-up
            screen was first reached, and a keyed hash (HMAC) of your IP
            address — for an IPv6 address, of its network prefix — (the raw
            IP is never stored). These records let us check that the viewing
            counters below reflect real playback, limit abuse, and measure
            how our own service is used. Lawful basis: <em>legitimate interests</em> — offering
            free viewing fairly and understanding how our own service is used,
            without third-party tracking. Like the{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">matio_aid</code>{" "}
            cookie on the website, the identifier is never shared with third
            parties or used for advertising.
          </li>
          <li>
            <strong>Viewing counters</strong> — the app reports which
            10-second stretches of an episode were played, and we add them to
            daily per-episode counters that hold no identifier — neither the
            device identifier nor your account. For a device that is not
            signed in, the identifier is only checked against the records
            above, so that the counters reflect real playback.
          </li>
          <li>
            <strong>How long we keep it</strong> — records kept against the
            device identifier are deleted 30 days after they are created (the
            &ldquo;Trial sessions&rdquo; period in section 6). One exception:
            if, within six hours of such a record being created, matio.tv is
            used from the same internet connection (the same IP address) by
            someone signed in to an account — usually you, for example on the
            same Wi-Fi — the record may be linked to that account, and a
            linked record is kept like the rest of that account&rsquo;s data
            (section 6) until the account is deleted. The viewing counters
            hold no personal data.
          </li>
          <li>
            <strong>If you sign in</strong> — to sign in or create an account,
            you enter your email address in the app, which sends it to Clerk,
            our authentication provider; Clerk emails you a one-time code.
            Instead, you can continue with Apple or Google: the app opens that
            provider&rsquo;s own sign-in screen, and the provider passes Clerk
            the details described in section 2 (with Apple you can choose to
            hide your email address). When you create an account with your
            email address, the app also passes Clerk the language you use in
            the app. Your sign-in session is kept in the
            device&rsquo;s secure storage. While you are signed in, the app
            sends us your watch progress — the episode, how far you got,
            whether you finished it and how long you watched — so you can
            pick up where you left off, in the app or on matio.tv; we also
            record the days on which you watched, to measure how our own
            service is used. Lawful basis: <em>performance of the contract</em>{" "}
            for your account and watch progress (section 3),{" "}
            <em>legitimate interests</em> for the days watched. Watch progress
            is kept while your account exists (section 6); the days watched
            are kept for up to 25 months. Both are erased if you delete your
            account.
          </li>
          <li>
            <strong>Kept only on your device</strong> — the autoplay setting.
            If you continue with Google, Google&rsquo;s own sign-in
            component also keeps your Google session (your Google account
            details and its sign-in tokens) in the device&rsquo;s secure
            storage, so it can recognise you next time; the app does not read
            it, and ends it when you sign out of Matio or delete your account.
          </li>
          <li>
            <strong>Providers</strong> — the app contains no analytics,
            advertising or tracking tools, and it does not track you across
            other companies&rsquo; apps or websites. Besides Sentry for error
            reports (below), it uses only providers already listed in section
            4: Vercel and Neon (our servers and database), Clerk (sign-in) and
            Mux (video and episode images) — and Apple or Google, only if you
            choose to sign in with them. Like any request to our servers,
            the app&rsquo;s requests carry your IP address and basic device
            details, handled as &ldquo;Technical data&rdquo; in section 2.
            When you open our Terms, this policy or the Cookie Policy from the
            app, the page opens in an in-app browser without our analytics or
            advertising tools.
          </li>
          <li>
            <strong>Error reports</strong> — when the app crashes or runs into
            an error, it can send a report to{" "}
            <strong>Functional Software, Inc.</strong> (Sentry; US company, our
            data held in its EU region; US transfers covered by the EU-US Data
            Privacy Framework and its UK Extension) so we can find and fix the
            fault. A
            report holds the technical details of the error, the app version,
            the device model, operating system and similar device details, a
            trail of recent app events with the parameters removed from web
            addresses, and a random identifier that Sentry&rsquo;s software
            creates on the device. It never includes
            your email address, your account or the device identifier above,
            and never a screenshot or a recording of your screen. Lawful
            basis: <em>legitimate interests</em> — keeping the app working.
            Sentry keeps reports for up to 90 days.
          </li>
          <li>
            <strong>Deleting your account</strong> — you can delete your
            account in the app at any time: Account → Delete account. Once you
            confirm, your account and the data we keep with it are erased,
            including your watch progress, the days you watched and your
            new-episode reminders; an active subscription is set to end at the
            close of the period you have paid for; and your billing records
            held by Stripe, our payment processor, are kept as described under
            &ldquo;Payment and tax records&rdquo; in section 6. You can also
            write to <strong>maksym@matio.tv</strong>, which is also how you
            exercise the other rights in section 7. Records kept against the
            device identifier are deleted 30 days after they are created, as
            above: deleting the account does not remove them sooner, and one
            that was linked to your account loses the link and then follows
            the same rule.
          </li>
        </ul>
      </Section>

      <Section id="contact" title="12. Contact">
        <p>
          Privacy questions: <strong>maksym@matio.tv</strong>. See also our{" "}
          <LegalLink href="/terms" className="underline underline-offset-2 hover:text-white">
            Terms of Service
          </LegalLink>{" "}
          and{" "}
          <LegalLink href="/cookies" className="underline underline-offset-2 hover:text-white">
            Cookie Policy
          </LegalLink>
          .
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
