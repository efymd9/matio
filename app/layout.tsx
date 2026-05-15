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
          // Card / modal surface — bumped a few stops above pure black so
          // Clerk's internal "secondary surface" (the sidebar) doesn't
          // crush down into the page background.
          colorBackground: "#1c1c22",
          colorInputBackground: "#2a2a30",
          colorInputText: "#ffffff",
          colorText: "#ffffff",
          // Secondary text (subtitles, "Manage your account info", inactive
          // sidebar items) — was #a8a8b3 which Clerk multiplied by its own
          // opacity into illegibility. Brighten it.
          colorTextSecondary: "#d4d4d8",
          colorTextOnPrimaryBackground: "#ffffff",
          colorNeutral: "#e4e4e7",
          borderRadius: "0.5rem",
        },
        elements: {
          // Sidebar of the Account / UserProfile modal. Match the main
          // panel background so the two halves don't visually split into
          // bright / dark, and bring the inactive button text up.
          navbar:
            "bg-[#1c1c22] border-r border-white/[0.06]",
          navbarButton:
            "text-white/75 hover:text-white hover:bg-white/[0.04]",
          navbarButton__active:
            "text-white bg-white/[0.06]",
          headerTitle: "text-white",
          headerSubtitle: "text-white/75",
          // Dividers between profile rows
          profileSectionPrimaryButton:
            "text-white/85 hover:text-white",
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
