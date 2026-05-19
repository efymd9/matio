import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createShow } from "@/app/admin/actions";

export default function NewShowPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to shows
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New show</h1>
      </div>

      <form action={createShow} className="max-w-2xl space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input id="title" name="title" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">Slug *</Label>
          <Input
            id="slug"
            name="slug"
            required
            placeholder="lowercase-with-hyphens"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" rows={4} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="posterImageUrl">Poster image URL</Label>
          <Input id="posterImageUrl" name="posterImageUrl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="heroImageUrl">Hero image URL</Label>
          <Input id="heroImageUrl" name="heroImageUrl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="genre">Genre</Label>
          <Input id="genre" name="genre" placeholder="action, drama, sci-fi" />
        </div>

        <fieldset className="space-y-3 rounded-md border border-border/60 p-4">
          <legend className="px-1 text-sm font-medium">
            Homepage sections
          </legend>
          <p className="text-xs text-muted-foreground">
            Choose which rows this show appears in on /. A show can be in
            both, either, or neither.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="justReleased"
              className="size-4 accent-accent"
            />
            Just released
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="popularNow"
              className="size-4 accent-accent"
            />
            Popular now
          </label>
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/admin" className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
          <Button type="submit">Create</Button>
        </div>
      </form>
    </div>
  );
}
