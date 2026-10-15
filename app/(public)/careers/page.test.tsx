import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { CareersFaq } from "@/components/careers/careers-faq";
import { CareersLanding } from "@/components/careers/careers-landing";
import { VACANCY_LIST } from "@/lib/careers";
import { en } from "@/lib/i18n/careers-dictionaries";

// The /careers route wrapper (#376): metadata, the ?role= preselect and what
// crosses to the client. Inspected as a JSX tree, not rendered — the form's
// behaviour is covered by components/careers/careers-landing.test.tsx and
// its stories.

vi.mock("server-only", () => ({}));
const action = vi.hoisted(() => ({ submitJobApplication: vi.fn() }));
vi.mock("./actions", () => action);

import CareersPage, { generateMetadata } from "./page";

type LandingProps = Parameters<typeof CareersLanding>[0];

async function landing(role?: string | string[]) {
  const el = await CareersPage({
    searchParams: Promise.resolve(role === undefined ? {} : { role }),
  });
  expect(el.type).toBe("main");
  const body = el.props.children as ReactElement<LandingProps>;
  expect(body.type).toBe(CareersLanding);
  return body.props;
}

describe("/careers metadata", () => {
  it("is titled Careers, English, its own canonical (never ?role=), indexed", async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe("Careers");
    expect(meta.title).toBe(en.meta.title);
    expect(meta.description).toBe(en.meta.description);
    expect(meta.alternates).toEqual({ canonical: "https://matio.tv/careers" });
    expect(meta.robots).toMatchObject({ index: true, follow: true });
  });
});

describe("/careers page", () => {
  it("hands the form both roles, the server action and the server-rendered FAQ", async () => {
    const props = await landing();
    expect(props.vacancies).toBe(VACANCY_LIST);
    expect(props.vacancies?.map((v) => v.id)).toEqual(["ai-creator", "sales-distribution"]);
    expect(props.submitJobApplication).toBe(action.submitJobApplication);
    expect(isValidElement(props.faq)).toBe(true);
    expect((props.faq as ReactElement).type).toBe(CareersFaq);
    expect(props.preselectedPosition).toBeNull();
  });

  it("?role=sales-distribution opens the form with Sales picked", async () => {
    expect((await landing("sales-distribution")).preselectedPosition).toBe(
      "sales-distribution",
    );
    expect((await landing("ai-creator")).preselectedPosition).toBe("ai-creator");
  });

  it("an unknown role or a repeated ?role= preselects nothing", async () => {
    expect((await landing("screenwriter")).preselectedPosition).toBeNull();
    expect((await landing(["ai-creator", "sales-distribution"])).preselectedPosition).toBeNull();
  });
});
