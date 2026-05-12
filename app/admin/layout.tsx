import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { MatioLogo } from "@/components/site/matio-logo";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      <nav className="sticky top-0 z-30 border-b border-white/[0.06] bg-background/85 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
          <Link
            href="/admin"
            className="group flex items-center gap-2"
            aria-label="Matio admin home"
          >
            <MatioLogo size={16} accent="#ff3d3d" color="#ffffff" />
            <span className="rounded-full bg-[#ff3d3d]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#ff3d3d]">
              Admin
            </span>
          </Link>
          <Link
            href="/admin"
            className="text-sm font-medium text-white/65 transition-colors hover:text-white"
          >
            Shows
          </Link>
          <Link
            href="/"
            className="ml-auto text-sm text-white/55 transition-colors hover:text-white"
          >
            ← Back to app
          </Link>
        </div>
      </nav>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
