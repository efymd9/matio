import Link from "next/link";
import { Icon } from "@/components/site/icon";
import { EMPTY_SHOW_FORM, ShowForm } from "@/components/admin/show-form";
import { createShow } from "@/app/admin/actions";
import { getAdminDict } from "@/lib/i18n/admin-server";

export default async function NewShowPage() {
  const { t } = await getAdminDict();
  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white"
        >
          <Icon name="back" size={14} />
          {t.showNew.backToShows}
        </Link>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
          {t.showNew.eyebrow}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          {t.showNew.heading}
        </h1>
        <p className="mt-1 text-sm text-white/55">
          {t.showNew.subheading}
        </p>
      </div>

      <ShowForm
        action={createShow}
        defaultValues={EMPTY_SHOW_FORM}
        mode="create"
        cancelHref="/admin"
      />
    </div>
  );
}
