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
          colorPrimary: "#e3963c",
          colorBackground: "#1f1d1b",
          colorInputBackground: "#282522",
          colorInputText: "#f5f4ef",
          colorText: "#f5f4ef",
          colorTextSecondary: "#bcb6ae",
          colorTextOnPrimaryBackground: "#1f1d1b",
          colorNeutral: "#bcb6ae",
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
          <div className="film-grain" aria-hidden />
        </body>
      </html>
    </ClerkProvider>
  );
}
