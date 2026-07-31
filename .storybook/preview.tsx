import type { Preview } from "@storybook/nextjs-vite";
import { Anton, Geist, Geist_Mono } from "next/font/google";
import * as React from "react";

// The real stylesheet, not a copy: the Lab renders components against the same
// tokens production does, so a drift in globals.css shows up here first.
import "../app/globals.css";

// Same three faces as app/layout.tsx, bound to the same CSS variables. Keep
// this list in sync with the layout — a component that looks right in the Lab
// and wrong in the app is worse than no Lab.
const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
const anton = Anton({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    // Matio ships dark-only (`<html className="dark">`), so the Lab's default
    // canvas is espresso, not white. The light swatch stays available because
    // :root still defines a light palette — if a component ever lands there,
    // it must be checkable.
    backgrounds: {
      options: {
        espresso: { name: "Espresso (prod)", value: "#0f0a07" },
        espresso2: { name: "Espresso 2 (raised)", value: "#1a120c" },
        light: { name: "Light (:root)", value: "#ffffff" },
      },
    },

    // The redesign's breakpoint system: mobile < 834 ≤ tablet < 1280 ≤ desktop.
    // These are the widths a new element has to be checked at — the same ones
    // the CSS actually switches on.
    viewport: {
      options: {
        mobile: {
          name: "Mobile (390)",
          styles: { width: "390px", height: "844px" },
        },
        tablet: {
          name: "Tablet (834)",
          styles: { width: "834px", height: "1112px" },
        },
        desktop: {
          name: "Desktop (1280)",
          styles: { width: "1280px", height: "800px" },
        },
      },
    },

    a11y: {
      // 'todo' — violations show in the test UI without failing CI. Raise to
      // 'error' once the existing components are clean; flipping it before
      // that makes the suite red on day one and teaches everyone to ignore it.
      test: "todo",
    },
  },

  initialGlobals: {
    backgrounds: { value: "espresso" },
  },

  decorators: [
    (Story) => (
      <div
        className={`dark ${geistSans.variable} ${geistMono.variable} ${anton.variable} bg-background font-sans text-foreground antialiased`}
        style={{ minHeight: "100%", padding: "1.5rem" }}
      >
        <Story />
      </div>
    ),
  ],
};

export default preview;
