"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EpisodeAccess } from "@/db/schema";
import { updateEpisodeAccess } from "@/app/admin/actions";

// Who can watch an episode. Labels mirror the viewer-facing tiers:
// Free = anonymous trial viewers, Members = any signed-in account,
// Subscribers = active subscription only.
const ACCESS_LABELS: Record<EpisodeAccess, string> = {
  free: "Free",
  member: "Members",
  subscriber: "Subscribers",
};

const ACCESS_ORDER: EpisodeAccess[] = ["free", "member", "subscriber"];

// Instant-apply variant for the season page's episode rows: changing the
// value fires the server action immediately (no Save button). Optimistic
// local state + disabled-while-pending keeps double-fires out; the row's
// server value wins on the revalidated render.
export function EpisodeAccessSelect({
  episodeId,
  seasonId,
  showId,
  value,
}: {
  episodeId: string;
  seasonId: string;
  showId: string;
  value: EpisodeAccess;
}) {
  const [current, setCurrent] = useState<EpisodeAccess>(value);
  const [pending, startTransition] = useTransition();
  return (
    <Select
      value={current}
      onValueChange={(v) => {
        const access = v as EpisodeAccess;
        setCurrent(access);
        startTransition(async () => {
          await updateEpisodeAccess(episodeId, seasonId, showId, access);
        });
      }}
      disabled={pending}
    >
      <SelectTrigger className="h-8 w-36 text-xs" aria-label="Who can watch">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACCESS_ORDER.map((a) => (
          <SelectItem key={a} value={a}>
            {ACCESS_LABELS[a]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Form-embedded variant for the episode edit page — submits with the form
// via a hidden input (same pattern as StatusSelect).
export function AccessFormSelect({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: EpisodeAccess;
}) {
  const [value, setValue] = useState<EpisodeAccess>(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select
        value={value}
        onValueChange={(v) => setValue(v as EpisodeAccess)}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACCESS_ORDER.map((a) => (
            <SelectItem key={a} value={a}>
              {ACCESS_LABELS[a]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
