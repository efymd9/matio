import { describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";
import { TEAM_SIZE } from "@/lib/about-team";
import { AboutContent } from "@/components/about/about-content";

// The route wrapper is thin — dict/locale/payments resolution and metadata.
// These tests execute exactly that: the JSX tree is inspected, not rendered
// (the body's rendering behaviour is covered by the AboutContent stories).

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/server", () => ({
  getDict: async () => ({ locale: "en", t: en }),
}));
vi.mock("@/lib/free-mode", () => ({ paymentsEnabled: () => false }));

import AboutPage, { generateMetadata } from "./page";

describe("/about page wrapper", () => {
  it("emits localized metadata with the hreflang cluster", async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe(en.about.metaTitle);
    expect(meta.description).toBe(en.about.metaDescription);
    const languages = meta.alternates?.languages as Record<string, string>;
    expect(languages.en).toContain("/about");
    expect(languages.es).toContain("/es/about");
    expect(meta.robots).toMatchObject({ index: true });
  });

  it("renders AboutContent with the resolved dict, mode and full roster", async () => {
    const el = await AboutPage();
    expect(el.type).toBe("main");
    const body = el.props.children;
    expect(body.type).toBe(AboutContent);
    expect(body.props.t).toBe(en);
    expect(body.props.locale).toBe("en");
    expect(body.props.paymentsOn).toBe(false);
    expect(body.props.team).toHaveLength(TEAM_SIZE);
  });
});
