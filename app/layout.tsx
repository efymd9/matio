import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { enUS, esES } from "@clerk/localizations";
import { cookies } from "next/headers";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { CookieBanner } from "@/components/site/cookie-banner";
import { MetaPixel } from "@/components/site/meta-pixel";
import { PostHogProvider } from "@/components/site/posthog-provider";
import { UserMenu } from "@/components/site/user-menu";
import { CONSENT_COOKIE, parseConsent } from "@/lib/cookie-consent";
import { LocaleProvider } from "@/lib/i18n/client";
import { getDict } from "@/lib/i18n/server";
import { SITE_URL } from "@/lib/seo";
import {
  jsonLdScript,
  organizationJsonLd,
  websiteJsonLd,
} from "@/lib/structured-data";
import "./globals.css";

// Clerk's hosted UI (sign-in modal, sign-up modal, UserButton dropdown,
// any form copy + validation messages) speaks the locale matching the
// site dictionary. Spanish is the default; English when the cookie
// resolves to "en". Both bundles ship server-side; only the chosen one
// crosses the server→client boundary via the ClerkProvider prop.
const CLERK_LOCALIZATIONS = { es: esES, en: enUS } as const;

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

// metadataBase resolves any relative OG/Twitter image URLs against the
// production origin. Override via NEXT_PUBLIC_APP_URL for preview branches
// so link unfurls in Slack/Twitter from staging URLs still point at the
// right host.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://matio.tv";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover lets us paint into the iOS notch / home-indicator
  // chin via env(safe-area-inset-*). Without it, those CSS values resolve
  // to 0 and any sticky/fixed UI sits on top of system chrome.
  viewportFit: "cover",
  themeColor: "#0a0a0c",
};

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getDict();
  return {
    metadataBase: new URL(APP_URL),
    title: {
      default: t.metadata.siteTitle,
      template: t.metadata.siteTitleTemplate,
    },
    description: t.metadata.siteDescription,
    applicationName: "matio",
    // Self-referencing canonical pinned to the apex (not metadataBase, which
    // is preview-host-overridable) so the four resolving hostnames + ?utm_*
    // variants consolidate onto matio.tv. No alternates.languages: ES/EN share
    // one URL, so hreflang would be self-referential and is structurally
    // invalid here.
    alternates: { canonical: SITE_URL },
    openGraph: {
      type: "website",
      siteName: "matio",
      url: SITE_URL,
      title: t.metadata.siteTitle,
      description: t.metadata.siteDescription,
      // Social-platform locale hints only — Google ignores og:locale for
      // language detection (it reads visible text). First-class fields so
      // Next emits valid `property="og:locale[:alternate]"` meta.
      locale: locale === "es" ? "es_ES" : "en_US",
      alternateLocale: locale === "es" ? "en_US" : "es_ES",
    },
    twitter: {
      card: "summary_large_image",
      title: t.metadata.twitterTitle,
      description: t.metadata.twitterDescription,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-video-preview": -1,
        "max-snippet": -1,
      },
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, t } = await getDict();
  // Read consent server-side so the banner doesn't flash in for users who
  // already chose. Layout is already dynamic via Clerk so reading cookies
  // here doesn't cost a static-generation opt-out.
  const consentCookie = (await cookies()).get(CONSENT_COOKIE)?.value;
  const initialConsent = parseConsent(consentCookie);
  return (
    <ClerkProvider
      localization={CLERK_LOCALIZATIONS[locale]}
      appearance={{
        // Official Clerk-designed dark baseTheme. Handles the navbar /
        // panel split, hover states, and opacity ramps so every surface
        // stays readable. We just layer the cinema-red accent on top
        // via colorPrimary.
        baseTheme: dark,
        variables: {
          colorPrimary: "#ff3d3d",
          borderRadius: "0.5rem",
        },
      }}
    >
      <html
        lang={t.htmlLang}
        className={`dark ${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      >
        <body className="min-h-full bg-background font-sans text-foreground selection:bg-accent/40">
          {/* Site-wide structured data. Server-rendered into the HTML so
              HTML-only crawlers read it. Locale-invariant brand graph
              (Spanish-default semantics); never varied by getLocale(). */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationJsonLd()) }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonLdScript(websiteJsonLd()) }}
          />
          <LocaleProvider locale={locale}>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black focus:shadow-lg"
            >
              Skip to content
            </a>
            <SiteHeader authSlot={<UserMenu />} />
            <div id="main-content">
              {children}
            </div>
            <SiteFooter />
            <CookieBanner initialConsent={initialConsent} />
            {/* Consent-gated Meta Pixel — only injects fbevents.js after the
                visitor accepts marketing cookies. Shares the same
                initialConsent the banner uses so it can fire on first paint
                for already-consented visitors. */}
            <MetaPixel initialConsent={initialConsent} />
            {/* Consent-gated PostHog — dynamically loads posthog-js only after
                the visitor accepts marketing cookies. Same initialConsent as
                the banner + Meta Pixel for first-paint tracking of returning
                consented visitors. */}
            <PostHogProvider initialConsent={initialConsent} />
          </LocaleProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
