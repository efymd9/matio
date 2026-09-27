import { ImageOptimizerCache } from "next/dist/server/image-optimizer";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import {
  OPTIMIZER_ACCEPT,
  OPTIMIZER_QUALITY,
  OPTIMIZER_WIDTHS,
  optimizedImageSource,
  optimizedImageUrl,
  snapImageWidth,
} from "./image-url";

// #292 item 10 — the app fetches show artwork through the site's image
// optimizer at the width it draws, instead of the 2–15 MB original. The URL
// is built client-side from a hand-kept width list, and /_next/image answers
// 400 to a width, a quality or a source it does not allow — so the last block
// runs every URL built here through Next's OWN parameter validation, under
// our real next.config.ts.

const BLOB =
  "https://waoyoctqyyvecbhm.public.blob.vercel-storage.com/shows/poster-ChatGPT-Image-17-.-2026-.-15_57_03-VceslEQDxE6LPWfbiMK5Hxdpud1bOR.png";

// The parameters of a built URL, decoded the way the optimizer decodes them.
function paramsOf(built: string | null) {
  if (!built) throw new Error("no URL built");
  const url = new URL(built);
  return {
    origin: url.origin,
    path: url.pathname,
    source: url.searchParams.get("url"),
    w: url.searchParams.get("w"),
    q: url.searchParams.get("q"),
  };
}

describe("optimizedImageUrl — which sources go through the optimizer", () => {
  it("a Blob upload goes as itself, to matio.tv's optimizer", () => {
    expect(paramsOf(optimizedImageUrl(BLOB, 786))).toEqual({
      origin: "https://matio.tv",
      path: "/_next/image",
      source: BLOB,
      w: "828",
      q: "75",
    });
  });

  it("a same-origin path goes as the path", () => {
    expect(paramsOf(optimizedImageUrl("/shows/cartero-mundo-poster.png", 444)).source).toBe(
      "/shows/cartero-mundo-poster.png",
    );
  });

  it("the absolute form /api/v1 gives a same-origin path goes back to the path — matio.tv is not a remote pattern", () => {
    const built = paramsOf(optimizedImageUrl("https://matio.tv/shows/cartero-mundo-poster.png", 444));
    expect(built.source).toBe("/shows/cartero-mundo-poster.png");
    expect(built.w).toBe("640");
  });

  it("leaves a signed Mux thumbnail and any other host alone", () => {
    const mux = "https://image.mux.com/abc/thumbnail.jpg?token=eyJ.dummy.sig";
    expect(optimizedImageUrl(mux, 400)).toBe(mux);
    expect(optimizedImageUrl("https://example.com/poster.png", 400)).toBe("https://example.com/poster.png");
    // Not a Blob host, only a look-alike path.
    const fake = "https://evil.example/x.public.blob.vercel-storage.com/p.png";
    expect(optimizedImageUrl(fake, 400)).toBe(fake);
    expect(optimizedImageUrl("//matio.tv/shows/x.png", 400)).toBe("//matio.tv/shows/x.png");
  });

  it("no artwork stays no artwork", () => {
    expect(optimizedImageUrl(null, 400)).toBeNull();
    expect(optimizedImageUrl("", 400)).toBeNull();
  });

  it("encodes the source so its own query and reserved characters survive the round trip", () => {
    // A Blob URL can no longer carry any of this (no query, upload-key
    // characters only — next block); a same-origin path still can.
    const odd = "/shows/hero a&b=c.png?v=2#x%20y";
    const built = optimizedImageUrl(odd, 1000);
    expect(built).toContain(`url=${encodeURIComponent(odd)}&w=1080&q=75`);
    expect(paramsOf(built).source).toBe(odd);
    expect(paramsOf(optimizedImageUrl("/shows/x.png?v=2", 100)).source).toBe("/shows/x.png?v=2");
  });
});

// #306 — only OUR store's upload folders go to the optimizer: the same list
// next.config.ts builds its remotePatterns from (lib/blob-artwork.ts).
const STORE = "https://waoyoctqyyvecbhm.public.blob.vercel-storage.com";

// The keys the uploader writes (UPLOAD_PATH + addRandomSuffix) — real
// shapes from the live catalog, plus an avatar.
const OUR_ARTWORK = [
  `${STORE}/shows/poster-ChatGPT-Image-23-.-2026-.-18_38_21-YOsHfa42ZnCxiKTma6UcTvOCbxjovZ.png`,
  `${STORE}/shows/hero-dd0c2c76-1dc4-4a2d-bfa4-2fa629985e64-MpgejEUYrWFPPwvGWe7HtgzUhWveXd.png`,
  `${STORE}/actors/avatar-lady-thorne-4kQm9bXw2ZrT7yPc1LdN0sVeHjUaGf.webp`,
];

// Remote images the optimizer must refuse under our next.config.ts.
const REFUSED = [
  // Another store — anyone's, which is what the old wildcard let through.
  "https://abc.public.blob.vercel-storage.com/shows/poster.png",
  "https://waoyoctqyyvecbhm.private.blob.vercel-storage.com/shows/poster.png",
  // Our store, outside the upload folders.
  `${STORE}/backups/matio-2026-09-27.dump.age`,
  `${STORE}/poster.png`,
  `${STORE}/showsx/poster.png`,
  // A query string — remotePatterns pin `search: ""`.
  `${STORE}/shows/poster.png?download=1`,
  // A dot segment, which `new URL` resolves out of the folder.
  `${STORE}/shows/../backups/db.dump`,
  // Not https.
  "http://waoyoctqyyvecbhm.public.blob.vercel-storage.com/shows/poster.png",
  // Mux: signed episode stills are <Image unoptimized>, so nothing needs it.
  "https://image.mux.com/pb-1/thumbnail.jpg?width=320&height=180&fit_mode=smartcrop&token=eyJ.dummy.sig",
  "https://image.mux.com/pb-1/thumbnail.png",
];

describe("optimizedImageUrl — which Blob URLs are ours (#306)", () => {
  it("sends show artwork and actor avatars on our store", () => {
    for (const src of OUR_ARTWORK) {
      expect(paramsOf(optimizedImageUrl(src, 400)).source).toBe(src);
    }
  });

  it("leaves every other remote URL as it was", () => {
    // Plus two the optimizer would take, but no upload key ever looks like:
    // stricter here costs a bigger download, looser would cost a 400.
    for (const other of [...REFUSED, `${STORE}/shows/poster.png#x`, `${STORE}/shows/./poster.png`]) {
      expect(optimizedImageUrl(other, 400), other).toBe(other);
    }
  });
});

describe("optimizedImageSource — the optimizer is asked for WebP", () => {
  it("an optimizer URL carries the Accept header that gets WebP back", () => {
    expect(optimizedImageSource(BLOB, 786)).toEqual({
      uri: optimizedImageUrl(BLOB, 786),
      headers: { Accept: OPTIMIZER_ACCEPT },
    });
    expect(optimizedImageSource("/shows/x.png", 100)?.headers).toEqual({ Accept: OPTIMIZER_ACCEPT });
  });

  it("a source left as it was goes out with no extra header", () => {
    const mux = "https://image.mux.com/abc/thumbnail.jpg?token=eyJ.dummy.sig";
    expect(optimizedImageSource(mux, 400)).toEqual({ uri: mux });
    expect(optimizedImageSource(null, 400)).toBeNull();
  });
});

describe("snapImageWidth — only widths the optimizer allows", () => {
  it("rounds UP to the next allowed width, so the image is never drawn upscaled", () => {
    expect(snapImageWidth(1)).toBe(32);
    expect(snapImageWidth(148 * 3)).toBe(640);
    expect(snapImageWidth(750)).toBe(750);
    expect(snapImageWidth(750.5)).toBe(828);
    expect(snapImageWidth(390 * 3)).toBe(1200);
  });

  it("caps at the largest allowed width", () => {
    expect(snapImageWidth(5000)).toBe(3840);
  });
});

describe("the width list is the one the deployed optimizer enforces", () => {
  const images = nextConfig.images ?? {};

  it("next.config.ts keeps Next's default sizes and quality, which the list copies", () => {
    expect(images.deviceSizes).toBeUndefined();
    expect(images.imageSizes).toBeUndefined();
    expect(images.qualities).toBeUndefined();
    expect([...OPTIMIZER_WIDTHS]).toEqual(
      [...imageConfigDefault.imageSizes, ...imageConfigDefault.deviceSizes].sort((a, b) => a - b),
    );
    expect(imageConfigDefault.qualities).toEqual([OPTIMIZER_QUALITY]);
  });

  // Next merges the site's images config over its defaults; validateParams
  // is the check /_next/image runs before it fetches anything.
  const merged = { images: { ...imageConfigDefault, ...images } } as never;
  const validate = (built: string | null, accept = OPTIMIZER_ACCEPT) => {
    const { source, w, q } = paramsOf(built);
    return ImageOptimizerCache.validateParams(
      { headers: { accept } } as never,
      { url: source ?? undefined, w: w ?? undefined, q: q ?? undefined },
      merged,
      false,
    );
  };

  it("accepts every width the helper can produce, for a Blob URL and a local path", () => {
    for (const px of [1, ...OPTIMIZER_WIDTHS.map((w) => w - 1), 9999]) {
      expect(validate(optimizedImageUrl(BLOB, px)), `w for ${px}px`).not.toHaveProperty("errorMessage");
      expect(validate(optimizedImageUrl("/shows/quedate-conmigo-poster.jpg", px))).not.toHaveProperty(
        "errorMessage",
      );
    }
  });

  it("answers WebP to OPTIMIZER_ACCEPT — and the source format to a native loader's own Accept", () => {
    const built = optimizedImageUrl(BLOB, 786);
    expect(validate(built)).toMatchObject({ mimeType: "image/webp" });
    // SDWebImage's default (expo-image on iOS): no `image/webp` in it, so the
    // optimizer would resize and keep the PNG — why the header is sent.
    expect(validate(built, "image/*,*/*;q=0.8")).toMatchObject({ mimeType: "" });
  });

  // The optimizer's own remote check, under our remotePatterns.
  const optimizerTakes = (url: string) =>
    !(
      "errorMessage" in
      ImageOptimizerCache.validateParams({ headers: {} } as never, { url, w: "640", q: "75" }, merged, false)
    );

  it("takes our store's upload folders — and refuses other stores, other folders, a query, Mux (#306)", () => {
    for (const src of OUR_ARTWORK) expect(optimizerTakes(src), src).toBe(true);
    for (const src of REFUSED) expect(optimizerTakes(src), src).toBe(false);
  });

  it("is never handed a remote URL it would refuse — the helper reads the same list", () => {
    for (const src of [BLOB, ...OUR_ARTWORK, ...REFUSED]) {
      const built = optimizedImageUrl(src, 640);
      if (built === src) continue;
      expect(optimizerTakes(paramsOf(built).source!), src).toBe(true);
    }
  });

  it("would refuse what the helper deliberately avoids: an unlisted width, a matio.tv absolute URL", () => {
    const blob = paramsOf(optimizedImageUrl(BLOB, 640));
    expect(
      ImageOptimizerCache.validateParams(
        { headers: {} } as never,
        { url: blob.source ?? undefined, w: "700", q: "75" },
        merged,
        false,
      ),
    ).toHaveProperty("errorMessage");
    expect(
      ImageOptimizerCache.validateParams(
        { headers: {} } as never,
        { url: "https://matio.tv/shows/x.png", w: "640", q: "75" },
        merged,
        false,
      ),
    ).toHaveProperty("errorMessage");
  });
});
