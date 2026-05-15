import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import {
  ClerkProvider,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { dark } from "@clerk/themes";
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
