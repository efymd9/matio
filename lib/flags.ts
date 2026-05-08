import { flag } from "flags/next";

export const showLanding = flag({
  key: "show-landing",
  description: "Gates the public landing page.",
  decide: () => process.env.SHOW_LANDING === "true",
});
