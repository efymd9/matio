import { ImageResponse } from "next/og";
import { createElement as h } from "react";
import { writeFileSync } from "node:fs";

// One-off raster icon generator for the Matio mark (outlined white circle +
// cinema-red disc on near-black). Renders via next/og (already a dep) so it
// needs no image tooling / new packages. Re-run after changing the mark:
//   pnpm tsx scripts/gen-icons.tsx
const BG = "#0a0a0c";
const ACCENT = "#ff3d3d";

function mark(size: number, scale: number) {
  const s = Math.round(size * scale);
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BG,
      },
    },
    h(
      "svg",
      { width: s, height: s, viewBox: "0 0 24 24", fill: "none" },
      h("circle", {
        cx: 12,
        cy: 12,
        r: 11,
        stroke: "#ffffff",
        strokeWidth: 1.6,
        fill: "none",
      }),
      h("circle", { cx: 12, cy: 12, r: 4.5, fill: ACCENT }),
    ),
  );
}

async function render(size: number, scale: number, path: string) {
  const res = new ImageResponse(mark(size, scale), { width: size, height: size });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  console.log("wrote", path, `(${buf.length} bytes)`);
}

// Full-bleed "any" icons + a padded "maskable" variant (mark inside the ~40%
// safe radius so Android's adaptive mask doesn't crop the ring) + apple-touch.
async function main() {
  await render(192, 1, "public/icon-192.png");
  await render(512, 1, "public/icon-512.png");
  await render(512, 0.6, "public/icon-maskable-512.png");
  await render(180, 1, "app/apple-icon.png");
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
