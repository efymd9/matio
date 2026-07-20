import Link from "next/link";
import { getAdminDict } from "@/lib/i18n/admin-server";

// Sub-navigation for the analytics surface (overview dashboard ↔ sessions
// feed). Server-only — calls getAdminDict() like components/admin/ui.tsx;
// active state is static per page, so no usePathname is needed.
export async function AnalyticsTabs({
  active,
}: {
  active: "overview" | "sessions";
}) {
  const { t } = await getAdminDict();
  const td = t.analyticsSessions;
  const tabs = [
    { key: "overview", href: "/admin/analytics", label: td.tabOverview },
    {
      key: "sessions",
      href: "/admin/analytics/sessions",
      label: td.tabSessions,
    },
  ] as const;
  return (
    <div className="flex w-fit overflow-hidden rounded-lg border border-white/10">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${
            tab.key === active
              ? "bg-gold text-gold-deep"
              : "bg-transparent text-cream/60 hover:text-cream"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
