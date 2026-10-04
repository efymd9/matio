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
// with the rest (#168). matio.tv/ideas is
// plain text on purpose: every internal link here must survive ?embed=app
// (app/(public)/legal-embed.test.tsx).
import type { Metadata } from "next";
import Link from "next/link";
import { LegalLink } from "@/components/site/legal-link";
import { isAppEmbed, legalPageRobots } from "@/lib/app-embed-server";
import { getDict } from "@/lib/i18n/server";
import { localeAlternates } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getDict();
  return {
    title: t.legal.privacyTitle,
    description: t.legal.privacyDescription,
    alternates: localeAlternates("/privacy", locale),
    robots: await legalPageRobots(),
  };
}

const LAST_UPDATED_ES = "27 de septiembre de 2026";
const LAST_UPDATED_EN = "September 27, 2026";

export default async function PrivacyPage() {
  const { locale, t } = await getDict();
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
            {t.legal.lastUpdated(locale === "en" ? LAST_UPDATED_EN : LAST_UPDATED_ES)}
          </p>
        </header>
        {locale === "en" ? <PrivacyEn /> : <PrivacyEs />}
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
          <strong>contact@matio.tv</strong>. Our data-protection contact is
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
            For anonymous previews we record a session token, the show id, an
            expiry timestamp, and a HMAC hash of your IP (the raw IP is never
            stored).
          </li>
          <li>
            <strong>Marketing-attribution data</strong> — if you arrive from a
            campaign URL we record the source / medium / campaign in two cookies
            and may attach the snapshot to your account at checkout for revenue
            attribution. If you accept marketing cookies, we also run the Meta
            Pixel and Meta Conversions API for advertising measurement (sharing a
            hashed email address, IP address and conversion events with Meta),
            PostHog for product analytics (funnel and engagement events, masked
            session replays, processed in the EU), and Google Analytics (GA4)
            for site-traffic measurement.
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
            <strong>To improve the service</strong> (aggregate analytics,
            playback-quality monitoring via Mux Data). Lawful basis:{" "}
            <em>legitimate interests</em>.
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
            <strong>Marketing and advertising measurement</strong> via the{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_first</code>{" "}
            and{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_last</code>{" "}
            cookies and, where enabled, the Meta Pixel, Meta Conversions API,
            PostHog (product-analytics funnel measurement), and Google Analytics
            (site-traffic measurement).
            Lawful basis: <em>consent</em> — these run only after you accept
            marketing cookies in the banner, and stop if you withdraw consent.
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
            signed playback. SCCs.
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
            after you accept marketing cookies. We share a hashed (SHA-256)
            email address, IP address and conversion events so Meta can
            attribute and optimise our ad campaigns. US transfers covered by
            SCCs.
          </li>
          <li>
            <strong>PostHog Inc.</strong> (US, EU Cloud region for our project)
            — product analytics. Our PostHog project is hosted on PostHog&rsquo;s
            EU Cloud (servers in the European Union), so behavioral and usage
            data stays in the EU. Only engaged after you accept marketing cookies.
            We send funnel events (page views, feature interactions, sign-up
            steps) and masked session replays. SCCs cover any onward transfers to
            PostHog&rsquo;s US infrastructure.
          </li>
          <li>
            <strong>Google Ireland Ltd</strong> (Ireland, with transfers to
            Google LLC in the US) — site analytics via Google Analytics 4. Only
            engaged after you accept marketing cookies. We share usage and device
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
            <strong>Namecheap, Inc.</strong> (PrivateEmail) — our mailbox at
            contact@matio.tv, for correspondence with you.
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
          <strong>contact@matio.tv</strong>. We will respond within 30 days.
        </p>
        <p>
          You can withdraw your consent to emails about new episodes and story
          calls at any time by writing to <strong>contact@matio.tv</strong> or
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
          learn we have, we will delete it. Story ideas may only be sent by
          people aged 18 or over.
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
            <strong>What the identifier is used for</strong> — when an episode
            plays, we may keep one record per show against the identifier: the
            show, when playback started, when a free preview expires, when the
            sign-up screen was first reached, and a HMAC hash of your IP
            address (the raw IP is never stored). These records let us apply
            the viewing rules to episodes you do not have full access to,
            whether or not you are signed in (such as the 60-second preview),
            limit abuse, and measure how our own service is used. Lawful basis: <em>legitimate interests</em> — offering
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
            <strong>Kept only on your device</strong> — the autoplay setting,
            and the language you choose in the app (apart from passing it to
            Clerk when you create an account with your email address, as
            above). If you continue with Google, Google&rsquo;s own sign-in
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
            write to <strong>contact@matio.tv</strong>, which is also how you
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
          Privacy questions: <strong>contact@matio.tv</strong>. See also our{" "}
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

function PrivacyEs() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="responsable" title="1. Quiénes somos">
        <p>
          DEEP ORDINARY LTD, sociedad registrada en Inglaterra y Gales
          (n.º&nbsp;17381666, domicilio social: 66 Paul Street, Londres
          EC2A&nbsp;4NA), es el responsable del tratamiento de los datos personales recogidos a
          través de <strong>matio.tv</strong>. Puedes contactarnos en{" "}
          <strong>contact@matio.tv</strong>. Nuestro contacto en materia de
          protección de datos es esa misma dirección. No hemos designado un
          Delegado de Protección de Datos y no estamos obligados a hacerlo
          conforme al artículo 37 del RGPD del Reino Unido.
        </p>
      </Section>

      <Section id="datos" title="2. Qué datos recogemos">
        <p>Tratamos las siguientes categorías de datos personales:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Datos de cuenta</strong>: dirección de correo electrónico,
            nombre (si lo facilitas) y tokens de autenticación. Los recoge y
            almacena Clerk por cuenta nuestra. También guardamos un registro
            mínimo (id Clerk, email, rol) en nuestra base de datos para
            gestionar la autorización. Si inicias sesión con Google o Apple,
            recibimos de ese proveedor, a través de Clerk, lo que decidas
            compartir con nosotros: tu dirección de correo electrónico (con
            Apple, posiblemente una dirección de reenvío privada que remite a
            la tuya), tu nombre y, de Google, tu foto de perfil, junto con el
            identificador de tu cuenta en el proveedor. Clerk los conserva con
            tu cuenta.
          </li>
          <li>
            <strong>Datos de suscripción y pago</strong>: nombre y dirección de
            facturación (necesarios para el cálculo del IVA), método de pago,
            historial de facturas, estado de la suscripción y fecha de
            vencimiento del periodo. Los recoge y almacena Stripe por cuenta
            nuestra. Nunca vemos el número completo de tu tarjeta; recibimos
            sólo una referencia de cliente de Stripe y los últimos cuatro
            dígitos enmascarados.
          </li>
          <li>
            <strong>Datos de uso</strong>: qué episodios has visto y la
            posición de reproducción, registrados por (usuario, episodio) para
            reanudar. Para las vistas previas anónimas registramos un token de
            sesión, el id de la serie, una fecha de expiración y un hash HMAC
            de tu dirección IP (la IP en claro no se almacena).
          </li>
          <li>
            <strong>Datos de atribución</strong>: si llegas desde una URL de
            campaña, guardamos la fuente, el medio y el nombre de campaña en
            dos cookies y podemos vincular la instantánea a tu cuenta al pagar
            para atribución de ingresos. Si aceptas las cookies de marketing,
            además usamos el Meta Pixel y la API de Conversiones de Meta para
            medición publicitaria (compartiendo un correo electrónico cifrado,
            dirección IP y eventos de conversión con Meta), PostHog para
            analítica de producto (eventos de embudo y de uso, grabaciones de
            sesión enmascaradas, procesados en la UE) y Google Analytics (GA4)
            para medir el tráfico del sitio. Consulta la{" "}
            <LegalLink href="/cookies" className="underline underline-offset-2 hover:text-white">
              Política de cookies
            </LegalLink>
            .
          </li>
          <li>
            <strong>Medición de audiencia de origen propio</strong>: una cookie
            exclusivamente de origen propio (<code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">matio_aid</code>)
            con un identificador anónimo aleatorio nos permite medir nuestra
            propia audiencia: los días en que nos visitaste, qué páginas viste
            (página de inicio, páginas de serie, muro de registro), la fuente /
            medio / campaña de marketing y el referente de tu primera visita, y
            el país desde el que se realizó la visita (deducido de tu IP; la
            dirección IP en claro nunca se almacena junto a él). Esto nunca se
            comparte con terceros ni se utiliza para publicidad o seguimiento
            entre sitios. Si más adelante creas una cuenta, el identificador se
            vincula a ella para poder asociar esa primera visita con tu
            registro. Puedes eliminar la cookie en cualquier momento desde la
            configuración de tu navegador.
          </li>
          <li>
            <strong>Comunicaciones</strong>: los correos que nos envías,
            conversaciones de soporte y correos transaccionales, como los
            avisos de nuevos episodios que solicitas.
          </li>
          <li id="ideas" className="scroll-mt-24">
            <strong>Ideas de historias</strong>: si nos envías una idea a
            través de matio.tv/ideas, guardamos la idea en sí (la serie que
            continúa o que se trata de una nueva, el título provisional, la
            premisa y la historia), el nombre o seudónimo que nos indicas y tu
            dirección de correo electrónico; si pediste recibir correos sobre
            nuevos episodios y convocatorias de historias, la versión de las
            Condiciones de envío de ideas que aceptaste y el idioma del sitio;
            y la campaña que te trajo, solo mientras las cookies de marketing
            estén activadas: en la UE/EEE, el Reino Unido y Suiza, después de
            que las aceptes en el banner; en el resto del mundo están activadas
            por defecto y puedes desactivarlas en «Preferencias de cookies», en
            el pie de página. No necesitas una cuenta para enviar una idea y no
            guardamos tu dirección IP junto con ella.
          </li>
          <li>
            <strong>Datos técnicos</strong>: dirección IP, agente del navegador
            y registros de petición necesarios para operar, asegurar y depurar
            el servicio. Se conservan hasta 30 días.
          </li>
        </ul>
      </Section>

      <Section id="finalidades" title="3. Para qué los usamos (bases jurídicas)">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Para prestarte el servicio</strong> (cuenta, reproducción,
            facturación). Base jurídica: <em>ejecución del contrato</em> que
            celebras al suscribirte.
          </li>
          <li>
            <strong>Para cumplir obligaciones legales</strong> (registros
            fiscales/IVA, derechos del consumidor, prevención del fraude,
            respuesta a requerimientos de autoridades). Base jurídica:{" "}
            <em>obligación legal</em>.
          </li>
          <li>
            <strong>Para mantener el servicio seguro</strong> (limitar abusos,
            detectar fraude, depurar). Base jurídica: <em>interés legítimo</em>{" "}
            de operar un servicio estable y seguro.
          </li>
          <li>
            <strong>Para mejorar el servicio</strong> (analítica agregada,
            monitorización de calidad de reproducción con Mux Data). Base
            jurídica: <em>interés legítimo</em>.
          </li>
          <li>
            <strong>Para revisar una idea de historia que nos envías</strong>,
            contactarte sobre ella y conservar constancia de la licencia que
            nos concedes. Base jurídica: <em>ejecución de un contrato</em>: las
            Condiciones de envío de ideas que aceptas al enviarla.{" "}
            <strong>Correos sobre nuevos episodios y convocatorias de
            historias</strong>: base jurídica <em>consentimiento</em>, solo si
            marcas la casilla; todavía no los enviamos.
          </li>
          <li>
            <strong>Marketing y medición publicitaria</strong> mediante las
            cookies{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_first</code>{" "}
            y{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_last</code>{" "}
            y, cuando está activado, el Meta Pixel, la API de Conversiones de
            Meta, PostHog (analítica de embudo de producto) y Google Analytics
            (medición del tráfico del sitio).
            Base jurídica: <em>consentimiento</em>: solo se ejecutan tras
            aceptar las cookies de marketing en el banner y se detienen si
            retiras el consentimiento.
          </li>
          <li>
            <strong>Medición de audiencia de origen propio</strong> (contar
            visitantes únicos y entender qué páginas se utilizan, mediante la
            cookie{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">matio_aid</code>).
            Base jurídica: <em>interés legítimo</em> de comprender cómo se usa
            nuestro propio servicio sin recurrir a seguimiento de terceros. Al
            tratarse de una medición estrictamente de origen propio y no usarse
            para publicidad, no requiere consentimiento.
          </li>
        </ul>
      </Section>

      <Section id="encargados" title="4. Con quién compartimos datos">
        <p>
          Nos apoyamos en encargados del tratamiento que procesan datos
          siguiendo nuestras instrucciones:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Clerk Inc.</strong> (EE. UU.) — autenticación.
            Transferencias UE/UK amparadas por las Cláusulas Contractuales Tipo
            (CCT).
          </li>
          <li>
            <strong>Stripe Payments Europe Ltd</strong> (Irlanda) — pagos y
            facturación. Puede transferir datos a sus filiales en EE. UU. bajo
            CCT.
          </li>
          <li>
            <strong>Mux Inc.</strong> (EE. UU.) — transcodificación,
            almacenamiento y reproducción firmada de vídeo. CCT.
          </li>
          <li>
            <strong>Vercel Inc.</strong> (EE. UU., regiones europeas para
            cómputo) — hosting. Las funciones de la aplicación se ejecutan en
            Fráncfort (eu-central-1); la CDN es global. CCT.
          </li>
          <li>
            <strong>Neon Inc.</strong> (EE. UU., región europea para nuestra
            base de datos) — Postgres alojado en AWS Fráncfort (eu-central-1).
            CCT.
          </li>
          <li>
            <strong>Resend Inc.</strong> (EE. UU., región europea para el
            envío) — correo transaccional: los avisos de nuevos episodios que
            solicitas. Compartimos la dirección de correo que dejaste y la
            serie a la que se refiere; cada correo incluye un enlace de baja.
            CCT.
          </li>
          <li>
            <strong>Meta Platforms Ireland Ltd</strong> (Irlanda, con
            transferencias a Meta Platforms Inc. en EE. UU.) — medición
            publicitaria mediante el Meta Pixel y la API de Conversiones. Solo
            se utiliza tras aceptar las cookies de marketing. Compartimos un
            correo electrónico cifrado (hash SHA-256), la dirección IP y eventos
            de conversión para que Meta pueda atribuir y optimizar nuestras
            campañas. Transferencias a EE. UU. amparadas por CCT.
          </li>
          <li>
            <strong>PostHog Inc.</strong> (EE. UU., región EU Cloud para
            nuestro proyecto) — analítica de producto. Nuestro proyecto de
            PostHog está alojado en PostHog Cloud EU (servidores en la Unión
            Europea), por lo que los datos de comportamiento y uso permanecen
            en la UE. Solo se utiliza tras aceptar las cookies de marketing.
            Enviamos eventos de embudo (visitas de página, interacciones,
            pasos del registro) y grabaciones de sesión enmascaradas.
            Las CCT cubren cualquier transferencia posterior a la infraestructura
            de EE. UU. de PostHog.
          </li>
          <li>
            <strong>Google Ireland Ltd</strong> (Irlanda, con transferencias a
            Google LLC en EE. UU.) — analítica del sitio mediante Google
            Analytics 4. Solo se utiliza tras aceptar las cookies de marketing.
            Compartimos datos de uso y de dispositivo (visitas de página,
            ubicación aproximada por IP, detalles de navegador/dispositivo) para
            medir el tráfico del sitio. Transferencias a EE. UU. amparadas por CCT.
          </li>
          <li>
            <strong>Google y Apple</strong> — solo si decides iniciar sesión
            con ellos. Google (Google Ireland Ltd y Google LLC) o Apple (Apple
            Distribution International Ltd y Apple Inc.) sabe que has iniciado
            sesión en Matio y nos transmite, a través de Clerk, los datos
            descritos en la sección 2. No son encargados nuestros: cada uno
            actúa como responsable independiente de tu cuenta de Google o de
            Apple, con su propia política de privacidad.
          </li>
          <li>
            <strong>Socios de producción</strong> — solo para una idea que
            desarrollemos contigo, y solo lo que necesite la producción.
          </li>
          <li>
            <strong>Namecheap, Inc.</strong> (PrivateEmail) — nuestro buzón
            contact@matio.tv, para la correspondencia contigo.
          </li>
        </ul>
        <p>
          No vendemos tus datos personales. Podemos divulgarlos cuando la ley
          lo exija, para hacer cumplir estos términos o para proteger
          derechos, seguridad o bienes.
        </p>
      </Section>

      <Section id="transferencias" title="5. Transferencias internacionales">
        <p>
          Algunos encargados están establecidos en EE. UU. Cuando los datos
          salen del EEE / Reino Unido, nos apoyamos en las Cláusulas
          Contractuales Tipo de la Comisión Europea y, cuando proceda, en el
          Adenda Internacional de Transferencia de Datos del Reino Unido.
          Stripe está establecido en Irlanda y procesa la mayor parte de los
          datos de facturación en la UE.
        </p>
      </Section>

      <Section id="conservacion" title="6. Cuánto los conservamos">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Cuenta</strong>: mientras tu cuenta exista, más un breve
            periodo de gracia tras su eliminación.
          </li>
          <li>
            <strong>Registros de pago y fiscales</strong>: durante el tiempo
            que exija la normativa fiscal y contable (habitualmente 6–10 años
            según la jurisdicción).
          </li>
          <li>
            <strong>Progreso de reproducción</strong>: mientras la cuenta
            exista.
          </li>
          <li>
            <strong>Sesiones de prueba</strong>: 30 días para analítica de
            abuso, luego se eliminan o anonimizan por completo.
          </li>
          <li>
            <strong>Datos de medición de audiencia</strong>: el identificador
            de audiencia de origen propio y los datos registrados junto a él se
            conservan hasta 25 meses, y después se eliminan o se anonimizan por
            completo.
          </li>
          <li>
            <strong>Ideas de historias</strong>: hasta 24 meses desde el envío,
            o más solo si desarrollamos tu idea contigo.
          </li>
          <li>
            <strong>Registros de petición y seguridad</strong>: 30 días.
          </li>
        </ul>
      </Section>

      <Section id="derechos" title="7. Tus derechos">
        <p>
          Tienes derecho de acceso, rectificación, supresión, limitación,
          portabilidad y oposición al tratamiento de tus datos personales, así
          como a retirar el consentimiento que hubieras prestado (por ejemplo
          rechazando las cookies de marketing en el banner). Para ejercerlos,
          escríbenos a <strong>contact@matio.tv</strong>. Responderemos en un
          plazo de 30 días.
        </p>
        <p>
          Puedes retirar en cualquier momento tu consentimiento para recibir
          correos sobre nuevos episodios y convocatorias de historias
          escribiendo a <strong>contact@matio.tv</strong> o mediante el enlace
          «darse de baja» de cualquier correo que te enviemos.
        </p>
        <p>
          Si consideras que no hemos tratado tus datos correctamente, puedes
          presentar una reclamación ante tu autoridad de control. En España es
          la Agencia Española de Protección de Datos (AEPD,{" "}
          <a href="https://www.aepd.es" className="underline underline-offset-2 hover:text-white">
            aepd.es
          </a>
          ). En Reino Unido es la Information Commissioner&rsquo;s Office
          (ICO,{" "}
          <a href="https://ico.org.uk" className="underline underline-offset-2 hover:text-white">
            ico.org.uk
          </a>
          ). En el resto del EEE, tu autoridad local es igualmente competente.
        </p>
      </Section>

      <Section id="menores" title="8. Menores">
        <p>
          El servicio está destinado a usuarios de 16 años o más. No recogemos
          conscientemente datos personales de menores. Si tenemos conocimiento
          de ello, los eliminaremos. Solo pueden enviar ideas de historias las
          personas de 18 años o más.
        </p>
      </Section>

      <Section id="seguridad" title="9. Seguridad">
        <p>
          Aplicamos medidas técnicas y organizativas apropiadas: TLS en todas
          las conexiones, cifrado en reposo, credenciales acotadas, tokens de
          reproducción firmados, verificación de firma en los webhooks y
          control de acceso de mínimo privilegio. Ningún sistema es totalmente
          seguro; si una violación de datos personales pudiera afectarte, te
          lo notificaremos junto con la autoridad competente, conforme exige
          la ley.
        </p>
      </Section>

      <Section id="cambios" title="10. Cambios en esta política">
        <p>
          Podemos actualizar esta Política de privacidad. Si un cambio es
          sustancial te avisaremos con un plazo razonable (normalmente por
          correo electrónico y mediante un aviso en el servicio).
        </p>
      </Section>

      {/* DRAFT (#312) — the Spanish twin of the English §11 above. */}
      <Section id="aplicacion" title="11. Nuestra aplicación móvil">
        <p>
          Esta sección trata de la aplicación de Matio para móviles. El resto
          de esta política también se aplica a la aplicación, salvo las
          cookies del sitio web y las herramientas que dependen de ellas, que
          la aplicación no utiliza. A continuación se describe lo que la
          aplicación añade.
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Identificador del dispositivo</strong>: la primera vez que
            la aplicación contacta con nuestros servidores, crea un
            identificador aleatorio (un UUID) que no contiene nada sobre ti ni
            sobre tu dispositivo. Lo guarda en el almacenamiento seguro del
            dispositivo (en iPhone, el llavero o keychain, donde la aplicación
            puede leerlo una vez que el teléfono se ha desbloqueado tras
            encenderse, para que la reproducción pueda continuar con la
            pantalla bloqueada) y lo envía con cada petición a nuestros
            servidores. En iPhone, el llavero puede conservar el identificador
            después de eliminar la aplicación, de modo que al reinstalarla
            puede volver el mismo identificador; en Android normalmente se
            elimina junto con la aplicación. Iniciar sesión en la aplicación
            no vincula el identificador a tu cuenta (para el único caso en
            que un registro asociado a él puede quedar vinculado, véase
            «Cuánto tiempo lo conservamos» más abajo).
          </li>
          <li>
            <strong>Para qué se usa el identificador</strong>: cuando se
            reproduce un episodio, podemos guardar un registro por serie
            asociado al identificador: la serie, cuándo empezó la
            reproducción, cuándo caduca una vista previa gratuita, cuándo se
            llegó por primera vez a la pantalla de registro y un hash HMAC de
            tu dirección IP (la IP en claro no se almacena). Estos registros
            nos permiten aplicar las reglas de visionado a los episodios a
            los que no tienes acceso completo, hayas iniciado sesión o no
            (como la vista previa de 60 segundos), limitar abusos y medir
            cómo se usa nuestro propio servicio. Base jurídica:{" "}
            <em>interés legítimo</em> de ofrecer el visionado gratuito de
            forma justa y de comprender cómo se usa nuestro propio servicio,
            sin recurrir a seguimiento de terceros. Como la cookie{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">matio_aid</code>{" "}
            del sitio web, el identificador nunca se comparte con terceros ni
            se utiliza para publicidad.
          </li>
          <li>
            <strong>Contadores de visionado</strong>: la aplicación indica qué
            tramos de 10 segundos de un episodio se reprodujeron, y los
            sumamos a contadores diarios por episodio que no contienen ningún
            identificador: ni el del dispositivo ni tu cuenta. En un
            dispositivo sin sesión iniciada, el identificador solo se
            comprueba contra los registros anteriores, para que los contadores
            reflejen reproducciones reales.
          </li>
          <li>
            <strong>Cuánto tiempo lo conservamos</strong>: los registros
            asociados al identificador del dispositivo se eliminan 30 días
            después de crearse (el plazo de las «Sesiones de prueba» de la
            sección 6). Una excepción: si, en las seis horas siguientes a la
            creación de uno de esos registros, alguien con la sesión iniciada
            en una cuenta usa matio.tv desde la misma conexión a internet (la
            misma dirección IP) —normalmente tú, por ejemplo en la misma red
            wifi—, el registro puede quedar vinculado a esa cuenta, y un
            registro vinculado se conserva como el resto de los datos de esa
            cuenta (sección 6) hasta que la cuenta se elimine. Los contadores
            de visionado no contienen datos personales.
          </li>
          <li>
            <strong>Si inicias sesión</strong>: para iniciar sesión o crear
            una cuenta, introduces tu dirección de correo electrónico en la
            aplicación, que la envía a Clerk, nuestro proveedor de
            autenticación; Clerk te envía por correo un código de un solo uso.
            También puedes continuar con Apple o Google: la aplicación abre la
            pantalla de inicio de sesión del propio proveedor, y este transmite
            a Clerk los datos descritos en la sección 2 (con Apple puedes
            elegir ocultar tu dirección de correo). Al crear una cuenta con tu
            dirección de correo, la aplicación también comunica a Clerk el
            idioma que usas en ella. Tu sesión se guarda en el almacenamiento
            seguro del dispositivo. Mientras tienes la sesión iniciada, la
            aplicación nos envía tu progreso de reproducción (el episodio,
            hasta dónde llegaste, si lo terminaste y cuánto tiempo lo viste)
            para que puedas continuar donde lo dejaste, en la aplicación o en
            matio.tv; también registramos los días en que viste algo, para
            medir cómo se usa nuestro propio servicio. Base jurídica:{" "}
            <em>ejecución del contrato</em> para tu cuenta y tu progreso de
            reproducción (sección 3), <em>interés legítimo</em> para los días
            de visionado. El progreso de reproducción se conserva mientras
            exista tu cuenta (sección 6); los días de visionado, hasta 25
            meses. Ambos se borran si eliminas tu cuenta.
          </li>
          <li>
            <strong>Solo en tu dispositivo</strong>: el ajuste de
            reproducción automática y el idioma que eliges en la aplicación
            (salvo cuando se lo comunica a Clerk al crear una cuenta con tu
            dirección de correo, como se indica arriba). Si continúas con
            Google, el propio componente de inicio de sesión de Google guarda
            además tu sesión de Google (los datos de tu cuenta de Google y sus
            tokens de inicio de sesión) en el almacenamiento seguro del
            dispositivo, para reconocerte la próxima vez; la aplicación no la
            lee y la cierra cuando cierras sesión en Matio o eliminas tu
            cuenta.
          </li>
          <li>
            <strong>Proveedores</strong>: la aplicación no contiene
            herramientas de analítica, publicidad ni seguimiento, y no te
            rastrea a través de aplicaciones o sitios web de otras empresas.
            Además de Sentry para los informes de errores (véase abajo), solo
            usa proveedores que ya figuran en la sección 4: Vercel y Neon
            (nuestros servidores y base de datos), Clerk (inicio de sesión) y
            Mux (vídeo e imágenes de los episodios), y Apple o Google, solo si
            decides iniciar sesión con ellos. Como cualquier petición a
            nuestros servidores, las de la aplicación llevan tu dirección IP y
            datos básicos del dispositivo, tratados como «Datos técnicos» en
            la sección 2. Cuando abres desde la aplicación nuestros Términos,
            esta política o la Política de cookies, la página se abre en un
            navegador integrado, sin nuestras herramientas de analítica ni de
            publicidad.
          </li>
          <li>
            <strong>Informes de errores</strong>: cuando la aplicación se
            cierra inesperadamente o encuentra un error, puede enviar un
            informe a <strong>Functional Software, Inc.</strong> (Sentry;
            empresa de EE. UU., nuestros datos alojados en su región de la UE;
            transferencias a EE. UU. amparadas por el Marco de Privacidad de
            Datos UE-EE. UU. y su extensión para el Reino Unido) para que
            podamos localizar y corregir el fallo. Un informe contiene los detalles técnicos del error, la
            versión de la aplicación, el modelo del dispositivo, el sistema
            operativo y datos similares del dispositivo, un registro de los
            últimos eventos de la aplicación con los parámetros eliminados de
            las direcciones web y un identificador aleatorio que el software
            de Sentry crea en el dispositivo. Nunca incluye tu dirección de
            correo electrónico, tu cuenta ni el identificador del dispositivo
            descrito arriba, y nunca una captura ni una grabación de tu
            pantalla. Base jurídica: <em>interés legítimo</em> de mantener la
            aplicación en funcionamiento. Sentry conserva los informes hasta
            90 días.
          </li>
          <li>
            <strong>Eliminar tu cuenta</strong>: puedes eliminar tu cuenta
            desde la aplicación en cualquier momento: Cuenta → Eliminar
            cuenta. Cuando lo confirmas, se borran tu cuenta y los datos que
            conservamos con ella, incluidos tu progreso de reproducción, los
            días de visionado y los avisos de nuevos episodios; una
            suscripción activa queda programada para terminar al final del
            periodo ya pagado; y tus registros de facturación que guarda
            Stripe, nuestro encargado de pagos, se conservan como se indica
            en «Registros de pago y fiscales» de la sección 6. También puedes
            escribirnos a <strong>contact@matio.tv</strong>, que es además la
            vía para ejercer los demás derechos de la sección 7. Los registros
            asociados al identificador del dispositivo se eliminan 30 días
            después de crearse, como se indica arriba: eliminar la cuenta no
            los borra antes, y uno que estuviera vinculado a tu cuenta pierde
            el vínculo y sigue la misma regla.
          </li>
        </ul>
      </Section>

      <Section id="contacto" title="12. Contacto">
        <p>
          Consultas de privacidad: <strong>contact@matio.tv</strong>. Consulta
          también nuestros{" "}
          <LegalLink href="/terms" className="underline underline-offset-2 hover:text-white">
            Términos del servicio
          </LegalLink>{" "}
          y la{" "}
          <LegalLink href="/cookies" className="underline underline-offset-2 hover:text-white">
            Política de cookies
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
