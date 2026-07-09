import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { MatioLogo } from "@/components/site/matio-logo";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { AdminLocaleProvider } from "@/lib/i18n/admin-client";
import { AdminLocaleSwitcher } from "@/components/admin/locale-switcher";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  // Admin-only locale (Russian default, `admin_locale` cookie) — separate
  // from the public es/en system so the panel language never leaks into
  // the visitor-facing site. See lib/i18n/admin-server.ts.
  const { locale, t } = await getAdminDict();
  return (
    <AdminLocaleProvider locale={locale}>
      <div className="flex min-h-screen flex-1 flex-col bg-background">
        <nav className="sticky top-0 z-30 border-b border-white/[0.06] bg-background/85 backdrop-blur-xl backdrop-saturate-150">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
            <Link
              href="/admin"
              className="group flex items-center gap-2"
              aria-label={t.nav.homeAria}
            >
              <MatioLogo size={16} />
              <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-gold">
                {t.nav.adminBadge}
              </span>
            </Link>
            <Link
              href="/admin"
              className="text-sm font-medium text-cream/65 transition-colors hover:text-cream"
            >
              {t.nav.shows}
            </Link>
            <Link
              href="/admin/actors"
              className="text-sm font-medium text-cream/65 transition-colors hover:text-cream"
            >
              {t.nav.actors}
            </Link>
            <Link
              href="/admin/analytics"
              className="text-sm font-medium text-cream/65 transition-colors hover:text-cream"
            >
              {t.nav.analytics}
            </Link>
            <Link
              href="/admin/links"
              className="text-sm font-medium text-cream/65 transition-colors hover:text-cream"
            >
              {t.nav.trackedLinks}
            </Link>
            <div className="ml-auto flex items-center gap-4">
              <Link
                href="/"
                className="text-sm text-cream/55 transition-colors hover:text-cream"
              >
                {t.nav.backToApp}
              </Link>
              <AdminLocaleSwitcher />
            </div>
          </div>
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          {children}
        </main>
      </div>
    </AdminLocaleProvider>
  );
}
