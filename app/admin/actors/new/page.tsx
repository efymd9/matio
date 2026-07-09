import Link from "next/link";
import { Icon } from "@/components/site/icon";
import { ActorForm, EMPTY_ACTOR_FORM } from "@/components/admin/actor-form";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { createActor } from "@/app/admin/actions";

export default async function NewActorPage() {
  const { t } = await getAdminDict();
  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <div>
        <Link
          href="/admin/actors"
          className="inline-flex items-center gap-1.5 text-sm text-cream/50 transition-colors hover:text-cream"
        >
          <Icon name="back" size={14} />
          {t.actorEdit.backToActors}
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-cream">
          {t.actorsList.newActor}
        </h1>
      </div>
      <ActorForm
        action={createActor}
        mode="create"
        defaultValues={EMPTY_ACTOR_FORM}
        cancelHref="/admin/actors"
      />
    </div>
  );
}
