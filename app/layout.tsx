import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import {
  ClerkProvider,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { SiteHeader } from "@/components/site/site-header";
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

export const metadata: Metadata = {
  title: "matio",
  description: "Original stories, streamed.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#ff3d3d",
          // Modal surface, bright enough that Clerk's internal "secondary
          // surface" (the modal's sidebar) doesn't crush into the page bg.
          colorBackground: "#26262d",
          colorInputBackground: "#33333b",
          colorInputText: "#ffffff",
          // Hand Clerk *white* for every text/neutral channel. Clerk
          // applies its own opacity ramps for inactive / secondary
          // elements — by starting at pure white, those derived colors
          // always land in the readable range (white at 70% is still
          // bright). Previously we passed a faded gray here and Clerk
          // multiplied it down past legibility for sidebar items.
          colorText: "#ffffff",
          colorTextSecondary: "#ffffff",
          colorTextOnPrimaryBackground: "#ffffff",
          colorNeutral: "#ffffff",
          borderRadius: "0.5rem",
        },
      }}
    >
      <html
        lang="en"
        className={`dark ${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      >
        <body className="min-h-full bg-background font-sans text-foreground selection:bg-accent/40">
          <SiteHeader
            authSlot={
              <>
                <Show when="signed-out">
                  <SignInButton mode="modal" />
                  <SignUpButton mode="modal" />
                </Show>
                <Show when="signed-in">
                  <UserButton
                    appearance={{
                      elements: {
                        userButtonAvatarBox:
                          "size-8 ring-1 ring-border hover:ring-accent/70 transition",
                      },
                    }}
                  />
                </Show>
              </>
            }
          />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
