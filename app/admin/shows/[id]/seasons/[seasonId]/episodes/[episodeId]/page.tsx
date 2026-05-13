import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UploadWidget } from "@/components/admin/upload-widget";
import { deleteEpisode, updateEpisode } from "@/app/admin/actions";

export default async function EditEpisodePage({
  params,
}: {
  params: Promise<{ id: string; seasonId: string; episodeId: string }>;
}) {
  const { id, seasonId, episodeId } = await params;

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

  const [episode] = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      description: episodes.description,
      durationSeconds: episodes.durationSeconds,
      muxAssetId: episodes.muxAssetId,
      muxPlaybackId: episodes.muxPlaybackId,
      status: episodes.status,
      introStartSeconds: episodes.introStartSeconds,
      introEndSeconds: episodes.introEndSeconds,
    })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.seasonId, season.id)))
    .limit(1);
  if (!episode) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/shows/${show.id}/seasons/${season.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to {show.title} — Season {season.number}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          Episode {episode.number}: {episode.title}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Video</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <span
                className={
                  episode.status === "ready"
                    ? "text-green-600"
                    : episode.status === "errored"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }
              >
                {episode.muxAssetId ? episode.status : "no video uploaded"}
              </span>
            </dd>
            <dt className="text-muted-foreground">Asset ID</dt>
            <dd className="font-mono text-xs">{episode.muxAssetId ?? "—"}</dd>
            <dt className="text-muted-foreground">Playback ID</dt>
            <dd className="font-mono text-xs">{episode.muxPlaybackId ?? "—"}</dd>
            <dt className="text-muted-foreground">Duration</dt>
            <dd>
              {episode.durationSeconds
                ? `${Math.floor(episode.durationSeconds / 60)}m ${episode.durationSeconds % 60}s`
                : "—"}
            </dd>
          </dl>
          <div className="border-t pt-4">
            <p className="mb-2 text-sm font-medium">
              {episode.muxAssetId ? "Replace video" : "Upload video"}
            </p>
            <UploadWidget episodeId={episode.id} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Episode details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={updateEpisode.bind(null, episode.id, season.id, show.id)}
            className="max-w-2xl space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[120px_1fr]">
              <div className="space-y-2">
                <Label htmlFor="number">Number *</Label>
                <Input
                  id="number"
                  name="number"
                  type="number"
                  min={1}
                  defaultValue={episode.number}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  name="title"
                  defaultValue={episode.title}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={episode.description ?? ""}
                rows={4}
              />
            </div>
            <div className="space-y-2 border-t border-white/[0.06] pt-4">
              <div className="flex items-baseline justify-between">
                <Label className="text-sm font-semibold text-white">
                  Skip intro
                </Label>
                <span className="text-[11px] text-white/45">
                  Leave both blank to hide the chip
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label
                    htmlFor="introStartSeconds"
                    className="text-xs text-white/65"
                  >
                    Start (seconds)
                  </Label>
                  <Input
                    id="introStartSeconds"
                    name="introStartSeconds"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="e.g. 5"
                    defaultValue={episode.introStartSeconds ?? ""}
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="introEndSeconds"
                    className="text-xs text-white/65"
                  >
                    End (seconds)
                  </Label>
                  <Input
                    id="introEndSeconds"
                    name="introEndSeconds"
                    type="number"
                    min={1}
                    step={1}
                    placeholder="e.g. 60"
                    defaultValue={episode.introEndSeconds ?? ""}
                  />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-white/50">
                The player shows a &quot;Skip intro&quot; pill while playback
                is in this window and seeks to End on click.
              </p>
            </div>
            <div className="flex justify-end">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={deleteEpisode.bind(null, episode.id, season.id, show.id)}
          >
            <Button variant="destructive" type="submit">
              Delete this episode
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
