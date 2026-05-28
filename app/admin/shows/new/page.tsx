import Link from "next/link";
import { Icon } from "@/components/site/icon";
import { EMPTY_SHOW_FORM, ShowForm } from "@/components/admin/show-form";
import { createShow } from "@/app/admin/actions";

export default function NewShowPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white"
        >
          <Icon name="back" size={14} />
          Shows
        </Link>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
          New show
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          Create a show
        </h1>
        <p className="mt-1 text-sm text-white/55">
          You can add seasons and episodes after it’s created.
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
