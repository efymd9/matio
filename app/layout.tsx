import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { SiteHeader } from "@/components/site/site-header";
import { UserMenu } from "@/components/site/user-menu";
import "./globals.css";

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
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://matio-ten.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "matio — original stories, streamed",
    template: "%s · matio",
  },
  description:
    "A subscription streaming home for original short-form stories. Watch the first 60 seconds free.",
  applicationName: "matio",
  openGraph: {
    type: "website",
    siteName: "matio",
    url: "/",
    title: "matio — original stories, streamed",
    description:
      "A subscription streaming home for original short-form stories. Watch the first 60 seconds free.",
  },
  twitter: {
    card: "summary_large_image",
    title: "matio",
    description:
      "Original stories, streamed. Watch the first 60 seconds free.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
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
        lang="en"
        className={`dark ${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      >
        <body className="min-h-full bg-background font-sans text-foreground selection:bg-accent/40">
          <SiteHeader authSlot={<UserMenu />} />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
