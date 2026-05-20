import Link from "next/link";
import { MatioLogo } from "@/components/site/matio-logo";
import { getDict } from "@/lib/i18n/server";

// Root 404. Catches /shows/<unknown-slug>, /watch/<unknown-slug>, and any
// other URL that doesn't resolve. Server component — fast TTFB.

export default async function NotFound() {
  const { t } = await getDict();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-5">
        <MatioLogo size={28} accent="#ff3d3d" />
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
          {t.notFound.code}
        </p>
        <h1 className="text-3xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-4xl">
          {t.notFound.title}
        </h1>
        <p className="max-w-sm text-sm text-white/55">
          {t.notFound.body}
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
        >
          {t.notFound.backHome}
        </Link>
      </div>
    </main>
  );
}
