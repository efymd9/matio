import { describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";
import { PressContent } from "@/components/about/press-content";

// Thin-wrapper test, same shape as the /about one: metadata cluster + the
// props handed to PressContent. Rendering itself is covered by stories.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/server", () => ({
  getDict: async () => ({ locale: "en", t: en }),
}));
vi.mock("@/lib/free-mode", () => ({ paymentsEnabled: () => false }));

import PressPage, { generateMetadata } from "./page";

describe("/press page wrapper", () => {
  it("emits localized metadata with the hreflang cluster", async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe(en.press.metaTitle);
    expect(meta.description).toBe(en.press.metaDescription);
    const languages = meta.alternates?.languages as Record<string, string>;
    expect(languages.en).toContain("/press");
    expect(languages.es).toContain("/es/press");
    expect(meta.robots).toMatchObject({ index: true });
  });

  it("renders PressContent with the resolved dict and mode", async () => {
    const el = await PressPage();
    expect(el.type).toBe("main");
    const body = el.props.children;
    expect(body.type).toBe(PressContent);
    expect(body.props.t).toBe(en);
    expect(body.props.locale).toBe("en");
    expect(body.props.paymentsOn).toBe(false);
  });
});
