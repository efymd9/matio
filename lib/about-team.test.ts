import { describe, expect, it } from "vitest";

import { TEAM_SIZE, teamForLocale } from "./about-team";

describe("teamForLocale", () => {
  it("returns the full roster for both locales, names shared", () => {
    const en = teamForLocale("en");
    const es = teamForLocale("es");
    expect(en).toHaveLength(TEAM_SIZE);
    expect(es).toHaveLength(TEAM_SIZE);
    expect(en.map((m) => m.name)).toEqual(es.map((m) => m.name));
  });

  it("localizes roles and descriptions", () => {
    const en = teamForLocale("en");
    const es = teamForLocale("es");
    const creative = en.findIndex((m) => m.role === "Creative Director");
    expect(creative).toBeGreaterThanOrEqual(0);
    expect(es[creative].role).toBe("Directora creativa");
    // Every member carries non-empty copy in both locales.
    for (const roster of [en, es]) {
      for (const m of roster) {
        expect(m.role.length).toBeGreaterThan(0);
        expect(m.desc.length).toBeGreaterThan(0);
        expect(m.initials.length).toBeGreaterThan(0);
      }
    }
  });

  it("composes a 160deg card gradient per member", () => {
    for (const m of teamForLocale("en")) {
      expect(m.gradient).toMatch(
        /^linear-gradient\(160deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 65%\)$/,
      );
    }
  });
});
