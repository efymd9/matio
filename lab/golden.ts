import { expect } from "vitest";

// Screenshot ("golden") assertion for the stories that define how the design
// system LOOKS — the variant boards and the token sheet. Ordinary stories do
// not take screenshots: a golden per story would turn every intentional
// design change into a hundred-file diff nobody reads.
//
// Two things worth knowing before you touch these:
//
// 1. Baselines are per browser AND per platform. Vitest writes
//    `<name>-chromium-linux.png` in CI and `<name>-chromium-darwin.png` on a
//    Mac — macOS and Linux rasterise text differently, and pretending
//    otherwise produces a suite that is red for everyone except its author.
//    Only the LINUX baselines are committed (`.gitignore` drops `*-darwin`),
//    so CI is the single source of truth. Locally the first run just writes
//    its own darwin baseline and passes — the real verdict comes from CI.
//
// 2. Updating a baseline is a DECISION, not a chore. When a golden fails,
//    look at the diff artifact CI attaches to the run before deciding whether
//    the change was intended. Then regenerate through the
//    `visual-baselines` workflow (Actions → Run workflow), download its
//    artifact and commit the PNGs in the SAME PR that changed the design.
//    Never "regenerate until green".
export async function golden(element: HTMLElement, name: string) {
  await expect.element(element).toMatchScreenshot(name);
}
