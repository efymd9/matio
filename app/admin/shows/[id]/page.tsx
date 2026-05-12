import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { seasons, shows } from "@/db/schema";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusSelect } from "@/components/admin/status-select";
import {
  createSeason,
  deleteSeason,
  setFeaturedShow,
  softDeleteShow,
  unsetFeaturedShow,
  updateShow,
} from "@/app/admin/actions";

export default async function EditShowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [show] = await db
    .select()
    .from(shows)
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)))
    .limit(1);

  if (!show) notFound();

  const showSeasons = await db
    .select()
    .from(seasons)
    .where(eq(seasons.showId, show.id))
    .orderBy(asc(seasons.number));

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to shows
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{show.title}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Show details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={updateShow.bind(null, show.id)}
            className="max-w-2xl space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                name="title"
                defaultValue={show.title}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Slug *</Label>
              <Input id="slug" name="slug" defaultValue={show.slug} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={show.description ?? ""}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="posterImageUrl">Poster image URL</Label>
              <Input
                id="posterImageUrl"
                name="posterImageUrl"
                defaultValue={show.posterImageUrl ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="heroImageUrl">Hero image URL</Label>
              <Input
                id="heroImageUrl"
                name="heroImageUrl"
                defaultValue={show.heroImageUrl ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="genre">Genre</Label>
              <Input
                id="genre"
                name="genre"
                defaultValue={show.genre.join(", ")}
                placeholder="action, drama, sci-fi"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <StatusSelect name="status" defaultValue={show.status} />
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Home hero</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {show.featured ? (
            <>
              <p className="text-sm">
                <span className="font-medium text-accent">Featured</span>{" "}
                <span className="text-muted-foreground">
                  on the home page hero. Only one show can be featured at a
                  time.
                </span>
              </p>
              <form action={unsetFeaturedShow.bind(null, show.id)}>
                <Button variant="outline" type="submit">
                  Remove from hero
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {show.status === "published"
                  ? "Promote this show to the home page hero. Any other featured show will be unfeatured."
                  : "Publish the show first — only published shows appear on the home page."}
              </p>
              <form action={setFeaturedShow.bind(null, show.id)}>
                <Button type="submit" disabled={show.status !== "published"}>
                  Feature on home
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seasons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <ul className="divide-y">
            {showSeasons.length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">
                No seasons yet.
              </li>
            )}
            {showSeasons.map((season) => (
              <li key={season.id} className="flex items-center gap-4 py-3">
                <span className="font-medium">Season {season.number}</span>
                {season.title && (
                  <span className="text-muted-foreground">— {season.title}</span>
                )}
                <div className="ml-auto flex gap-2">
                  <Link
                    href={`/admin/shows/${show.id}/seasons/${season.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Manage episodes
                  </Link>
                  <form action={deleteSeason.bind(null, season.id, show.id)}>
                    <Button variant="destructive" size="sm" type="submit">
                      Delete
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>

          <form
            action={createSeason.bind(null, show.id)}
            className="space-y-3 border-t pt-4"
          >
            <p className="text-sm font-medium">Add a season</p>
            <div className="flex gap-2">
              <Input
                name="number"
                type="number"
                min={1}
                placeholder="#"
                required
                className="w-20"
              />
              <Input
                name="title"
                placeholder="Title (optional)"
                className="flex-1"
              />
              <Button type="submit">Add</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={softDeleteShow.bind(null, show.id)}>
            <Button variant="destructive" type="submit">
              Delete this show
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
