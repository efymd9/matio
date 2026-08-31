import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { organizationJsonLd, websiteJsonLd, ORG_ID } from "./structured-data";

// The Organization node is the entity graph search engines and AI crawlers read
// to answer "who is behind Matio". What is asserted here is that it names the
// COMPANY and lets that claim be verified — and never a person.

describe("organizationJsonLd", () => {
  const org = organizationJsonLd();

  it("identifies the operator as the company, verifiably", () => {
    expect(org.legalName).toBe("DEEP ORDINARY LTD");
    // Machine-readable registration, not just prose — the number a crawler can
    // check against the register.
    expect(org.identifier).toMatchObject({
      "@type": "PropertyValue",
      propertyID: "GB-COH",
      value: "17381666",
    });
    expect(org.foundingDate).toBe("2026-08-04");
  });

  it("lets the entity be confirmed against Companies House via sameAs", () => {
    const sameAs = org.sameAs as string[];
    expect(
      sameAs.some((u) =>
        u.includes("company-information.service.gov.uk/company/17381666"),
      ),
    ).toBe(true);
    // The social profiles are still there — CH is an addition, not a swap.
    expect(sameAs.length).toBeGreaterThan(1);
  });

  it("never carries a personal name", () => {
    // The whole point of #141: the graph must not re-attach the owner's name.
    const raw = JSON.stringify(org).toLowerCase();
    expect(raw).not.toContain("dobrovolski");
    expect(raw).not.toContain("matvei");
    // founder/creator/author would invite a person; the node has none.
    expect(org).not.toHaveProperty("founder");
    expect(org).not.toHaveProperty("creator");
  });
});

describe("websiteJsonLd", () => {
  it("credits the same Organization node as publisher", () => {
    const site = websiteJsonLd();
    expect(site.publisher).toEqual({ "@id": ORG_ID });
  });
});
