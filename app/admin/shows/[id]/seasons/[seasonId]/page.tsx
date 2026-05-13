import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
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
import { createEpisode, deleteEpisode } from "@/app/admin/actions";

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ id: string; seasonId: string }>;
}) {
  const { id, seasonId } = await params;

  const [show] = await db
    .select()
    .from(shows)
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)))
    .limit(1);
  if (!show) notFound();

  const [season] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), eq(seasons.showId, show.id)))
    .limit(1);
  if (!season) notFound();

  // Explicit columns — intro_* live in schema but aren't in prod yet.
  const seasonEpisodes = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      description: episodes.description,
      status: episodes.status,
      muxAssetId: episodes.muxAssetId,
    })
    .from(episodes)
    .where(eq(episodes.seasonId, season.id))
    .orderBy(asc(episodes.number));

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/shows/${show.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to {show.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {show.title} — Season {season.number}
          {season.title && (
            <span className="ml-2 text-muted-foreground">
              ({season.title})
            </span>
          )}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Episodes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <ul className="divide-y">
            {seasonEpisodes.length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">
                No episodes yet.
              </li>
            )}
            {seasonEpisodes.map((episode) => (
              <li key={episode.id} className="flex items-start gap-4 py-3">
                <div className="font-medium">{episode.number}.</div>
                <div className="flex-1">
                  <div className="font-medium">{episode.title}</div>
                  {episode.description && (
                    <div className="text-sm text-muted-foreground">
                      {episode.description}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {episode.status}
                    {!episode.muxAssetId && " — no video uploaded"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/admin/shows/${show.id}/seasons/${season.id}/episodes/${episode.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Edit
                  </Link>
                  <form
                    action={deleteEpisode.bind(null, episode.id, season.id, show.id)}
                  >
                    <Button variant="destructive" size="sm" type="submit">
                      Delete
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>

          <form
            action={createEpisode.bind(null, season.id, show.id)}
            className="space-y-3 border-t pt-4"
          >
            <p className="text-sm font-medium">Add an episode</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[80px_1fr]">
              <div className="space-y-1">
                <Label htmlFor="ep-number" className="text-xs">
                  Number *
                </Label>
                <Input
                  id="ep-number"
                  name="number"
                  type="number"
                  min={1}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ep-title" className="text-xs">
                  Title *
                </Label>
                <Input id="ep-title" name="title" required />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ep-description" className="text-xs">
                Description
              </Label>
              <Textarea id="ep-description" name="description" rows={2} />
            </div>
            <div className="flex justify-end">
              <Button type="submit">Add episode</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
