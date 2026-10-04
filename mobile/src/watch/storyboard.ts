import { useEffect, useState } from "react";

// The frames over the landscape player's scrub bar (#375): Mux's storyboard —
// one sprite of evenly spaced stills plus a WebVTT file that says which tile
// of the sprite covers which stretch of the episode:
//
//   00:00:00.000 --> 00:00:10.000
//   https://image.mux.com/<id>/storyboard.jpg?token=…#xywh=0,0,256,144
//
// The playback ids are signed, so the file is fetched with the storyboard
// token /v1/playback-token mints next to the playback one (audience `s`, the
// same lifetime); Mux puts the token on the sprite URLs it writes into the
// file. Best-effort from end to end: no token, a failed fetch, a file that
// does not parse — the bar scrubs with the time alone.

export const MUX_IMAGE_ORIGIN = "https://image.mux.com";

export type StoryboardTile = {
  start: number;
  end: number;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Storyboard = {
  tiles: StoryboardTile[];
  // Each sprite's full size, read off the tiles that cover it — the image is
  // drawn at that size, scaled, behind a tile-sized window.
  sprites: Record<string, { width: number; height: number }>;
};

export function storyboardUrl(playbackId: string, token: string): string {
  return `${MUX_IMAGE_ORIGIN}/${playbackId}/storyboard.vtt?token=${encodeURIComponent(token)}`;
}

// "01:02:03.456" or "02:03.456" → seconds; NaN for anything else.
function parseTimestamp(value: string): number {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return Number.NaN;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

const XYWH = /#xywh=(\d+),(\d+),(\d+),(\d+)$/;

export function parseStoryboardVtt(text: string, token: string): Storyboard | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (!lines[0]?.startsWith("WEBVTT")) return null;

  const tiles: StoryboardTile[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const timing = lines[i].split("-->");
    if (timing.length !== 2) continue;
    const start = parseTimestamp(timing[0]);
    const end = parseTimestamp(timing[1]);
    const cue = XYWH.exec(lines[i + 1]);
    if (!cue || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    tiles.push({
      start,
      end,
      url: signedSpriteUrl(lines[i + 1].slice(0, cue.index), token),
      x: Number(cue[1]),
      y: Number(cue[2]),
      width: Number(cue[3]),
      height: Number(cue[4]),
    });
  }
  if (tiles.length === 0) return null;

  const sprites: Storyboard["sprites"] = {};
  for (const tile of tiles) {
    const size = (sprites[tile.url] ??= { width: 0, height: 0 });
    size.width = Math.max(size.width, tile.x + tile.width);
    size.height = Math.max(size.height, tile.y + tile.height);
  }
  return { tiles, sprites };
}

// A sprite URL as Mux wrote it — but should one ever come back on our image
// host without the token, the storyboard token opens it (a signed playback
// id answers 403 to an unsigned image request).
function signedSpriteUrl(url: string, token: string): string {
  if (!url.startsWith(`${MUX_IMAGE_ORIGIN}/`) || /[?&]token=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

// The tile on screen at `seconds`: the cue that covers it, else the nearest
// one (the last cue may end a beat before the episode does).
export function tileAt(board: Storyboard, seconds: number): StoryboardTile {
  const { tiles } = board;
  const hit = tiles.find((tile) => seconds >= tile.start && seconds < tile.end);
  if (hit) return hit;
  return seconds < tiles[0].start ? tiles[0] : tiles[tiles.length - 1];
}

// The page's storyboard, fetched once per token while `enabled` (the page in
// view, landscape). A new token — the hourly refresh — fetches it again, so
// the sprite URLs inside never outlive their signature; the old board stays
// on screen until the new one lands (its token still has a minute to run).
export function useStoryboard(
  playbackId: string | null,
  token: string | null,
  enabled: boolean,
): Storyboard | null {
  const [board, setBoard] = useState<{
    playbackId: string;
    token: string;
    value: Storyboard;
  } | null>(null);
  const fetched = board !== null && board.playbackId === playbackId && board.token === token;

  useEffect(() => {
    if (!enabled || !playbackId || !token || fetched) return;
    const controller = new AbortController();
    fetch(storyboardUrl(playbackId, token), { signal: controller.signal })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        const value = parseStoryboardVtt(text, token);
        if (value) setBoard({ playbackId, token, value });
      })
      .catch(() => {
        // No frames, only the time — the scrub itself works either way.
      });
    return () => controller.abort();
  }, [enabled, playbackId, token, fetched]);

  return board !== null && board.playbackId === playbackId ? board.value : null;
}
