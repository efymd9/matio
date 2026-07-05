#!/usr/bin/env bash
# One-off raster icon generator for the Matio app icons: the client-provided
# dark-red "M" blob mark (public/brand/matio-mark.png, 1043×931 transparent)
# centered on the espresso brand background. Uses macOS sips — no npm deps.
# Re-run after changing the mark:  pnpm gen:icons
set -euo pipefail
cd "$(dirname "$0")/.."

MARK=public/brand/matio-mark.png
BG=0F0A07 # espresso #0f0a07
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Regular icons: pad the mark to a 1200×1200 square on espresso, then resize.
# Maskable icon: pad to 1500×1500 so the mark stays inside the inner-80%
# safe zone when platforms apply a circle mask.
sips "$MARK" --padToHeightWidth 1200 1200 --padColor $BG --out "$TMP/square.png" >/dev/null
sips "$MARK" --padToHeightWidth 1500 1500 --padColor $BG --out "$TMP/maskable.png" >/dev/null

sips "$TMP/square.png" -z 512 512 --out app/icon.png >/dev/null
sips "$TMP/square.png" -z 180 180 --out app/apple-icon.png >/dev/null
sips "$TMP/square.png" -z 192 192 --out public/icon-192.png >/dev/null
sips "$TMP/square.png" -z 512 512 --out public/icon-512.png >/dev/null
sips "$TMP/maskable.png" -z 512 512 --out public/icon-maskable-512.png >/dev/null

echo "regenerated: app/icon.png app/apple-icon.png public/icon-{192,512,maskable-512}.png"
