import { ImageOptimizerCache } from "next/dist/server/image-optimizer";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import {
  OPTIMIZER_QUALITY,
  OPTIMIZER_WIDTHS,
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
    const odd = "https://abc.public.blob.vercel-storage.com/shows/hero a&b=c?v=2#x%20y.png";
    const built = optimizedImageUrl(odd, 1000);
    expect(built).toContain(`url=${encodeURIComponent(odd)}&w=1080&q=75`);
    expect(paramsOf(built).source).toBe(odd);
    expect(paramsOf(optimizedImageUrl("/shows/x.png?v=2", 100)).source).toBe("/shows/x.png?v=2");
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
  const validate = (built: string | null) => {
    const { source, w, q } = paramsOf(built);
    return ImageOptimizerCache.validateParams(
      { headers: { accept: "image/webp,*/*" } } as never,
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
