/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseStoryboardVtt,
  storyboardUrl,
  tileAt,
  useStoryboard,
  type Storyboard,
} from "./storyboard";

// The scrub preview's storyboard (#375): Mux's WebVTT — which sprite tile
// covers which stretch of the episode — parsed, looked up, and fetched for
// the page in view with the storyboard token the playback-token route mints.

const SPRITE = "https://image.mux.com/pb-1/storyboard.jpg?token=sb-1";

const VTT = [
  "WEBVTT",
  "",
  "00:00:00.000 --> 00:00:10.000",
  `${SPRITE}#xywh=0,0,256,144`,
  "",
  "00:00:10.000 --> 00:00:20.000",
  `${SPRITE}#xywh=256,0,256,144`,
  "",
  "00:00:20.000 --> 00:01:05.500",
  `${SPRITE}#xywh=0,144,256,144`,
  "",
].join("\n");

describe("parseStoryboardVtt", () => {
  it("reads every cue's time span and tile, and the sprite's full size off the tiles", () => {
    const board = parseStoryboardVtt(VTT, "sb-1");

    expect(board?.tiles).toEqual([
      { start: 0, end: 10, url: SPRITE, x: 0, y: 0, width: 256, height: 144 },
      { start: 10, end: 20, url: SPRITE, x: 256, y: 0, width: 256, height: 144 },
      { start: 20, end: 65.5, url: SPRITE, x: 0, y: 144, width: 256, height: 144 },
    ]);
    expect(board?.sprites).toEqual({ [SPRITE]: { width: 512, height: 288 } });
  });

  it("reads hour-less timestamps and CRLF line ends too", () => {
    const vtt = ["WEBVTT", "", "00:05.000 --> 01:00.000", `${SPRITE}#xywh=0,0,10,10`].join("\r\n");
    expect(parseStoryboardVtt(vtt, "sb-1")?.tiles[0]).toMatchObject({ start: 5, end: 60 });
  });

  it("opens a sprite URL that came back unsigned on Mux's image host with the storyboard token", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:10.000",
      "https://image.mux.com/pb-1/storyboard.jpg#xywh=0,0,256,144",
    ].join("\n");
    expect(parseStoryboardVtt(vtt, "a b")?.tiles[0].url).toBe(
      "https://image.mux.com/pb-1/storyboard.jpg?token=a%20b",
    );
  });

  it("answers null for anything that is not a storyboard — the bar then scrubs with the time alone", () => {
    expect(parseStoryboardVtt("", "t")).toBeNull();
    expect(parseStoryboardVtt("<html>Forbidden</html>", "t")).toBeNull();
    expect(parseStoryboardVtt("WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nno tile here", "t")).toBeNull();
  });
});

describe("tileAt", () => {
  const board = parseStoryboardVtt(VTT, "sb-1") as Storyboard;

  it("is the cue covering the time; past the last cue, the last tile", () => {
    expect(tileAt(board, 0).x).toBe(0);
    expect(tileAt(board, 12).x).toBe(256);
    expect(tileAt(board, 30).y).toBe(144);
    expect(tileAt(board, 999).y).toBe(144);
  });
});

describe("useStoryboard", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let container: HTMLDivElement;
  let root: Root;
  let seen: Array<Storyboard | null>;
  const fetchMock = vi.fn();

  function Probe(props: { playbackId: string | null; token: string | null; enabled: boolean }) {
    seen.push(useStoryboard(props.playbackId, props.token, props.enabled));
    return null;
  }

  async function render(props: { playbackId: string | null; token: string | null; enabled: boolean }) {
    act(() => root.render(<Probe {...props} />));
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  beforeEach(() => {
    seen = [];
    fetchMock.mockReset().mockResolvedValue({ ok: true, text: async () => VTT });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("fetches the signed storyboard of the page in view, once per token", async () => {
    await render({ playbackId: "pb-1", token: "sb-1", enabled: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(storyboardUrl("pb-1", "sb-1"));
    expect(storyboardUrl("pb-1", "sb-1")).toBe(
      "https://image.mux.com/pb-1/storyboard.vtt?token=sb-1",
    );
    expect(seen.at(-1)?.tiles).toHaveLength(3);

    // A re-render asks nothing; the hourly token asks again.
    await render({ playbackId: "pb-1", token: "sb-1", enabled: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await render({ playbackId: "pb-1", token: "sb-2", enabled: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(storyboardUrl("pb-1", "sb-2"));
  });

  it("asks nothing for a page not in view, or without a token (a server from before #375)", async () => {
    await render({ playbackId: "pb-1", token: "sb-1", enabled: false });
    await render({ playbackId: "pb-1", token: null, enabled: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(seen.at(-1)).toBeNull();
  });

  it("a refused fetch is no storyboard, quietly", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "" });
    await render({ playbackId: "pb-1", token: "sb-1", enabled: true });

    expect(seen.at(-1)).toBeNull();
  });
});
