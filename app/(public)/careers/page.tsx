import type { Metadata } from "next";
import { CareersFaq } from "@/components/careers/careers-faq";
import { CareersLanding } from "@/components/careers/careers-landing";
import { VACANCY_LIST, isJobPosition } from "@/lib/careers";
import { en as t } from "@/lib/i18n/careers-dictionaries";
import { canonicalUrl } from "@/lib/seo";
import { submitJobApplication } from "./actions";

// /careers — the two open roles and the one application form (#376, design
// variant A of the "Matio Careers" canvas). Indexed, English only; the
// canonical never carries `?role=`. Copy comes from
// lib/i18n/careers-dictionaries.ts and the roles from lib/careers.ts. The
// server action is handed to the client form as a prop, so the form never
// imports a server module.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: { canonical: canonicalUrl("/careers") },
    robots: { index: true, follow: true },
  };
}

export default async function CareersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  const { role } = await searchParams;
  // `?role=<id>` preselects a role only when it names one; a repeated
  // `?role=a&role=b` arrives as an array and preselects nothing.
  const preselected = isJobPosition(role) ? role : null;

  return (
    <main>
      <CareersLanding
        vacancies={VACANCY_LIST}
        preselectedPosition={preselected}
        submitJobApplication={submitJobApplication}
        faq={<CareersFaq t={t} />}
      />
    </main>
  );
}
