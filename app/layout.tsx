import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { enUS, esES } from "@clerk/localizations";
import { SiteHeader } from "@/components/site/site-header";
import { UserMenu } from "@/components/site/user-menu";
import { LocaleProvider } from "@/lib/i18n/client";
import { getDict } from "@/lib/i18n/server";
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

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    metadataBase: new URL(APP_URL),
    title: {
      default: t.metadata.siteTitle,
      template: t.metadata.siteTitleTemplate,
    },
    description: t.metadata.siteDescription,
    applicationName: "matio",
    openGraph: {
      type: "website",
      siteName: "matio",
      url: "/",
      title: t.metadata.siteTitle,
      description: t.metadata.siteDescription,
    },
    twitter: {
      card: "summary_large_image",
      title: t.metadata.twitterTitle,
      description: t.metadata.twitterDescription,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, t } = await getDict();
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
          <LocaleProvider locale={locale}>
            <SiteHeader authSlot={<UserMenu />} />
            {children}
          </LocaleProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
