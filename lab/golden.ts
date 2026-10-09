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
//    so CI is the single source of truth. Locally the first run writes its
//    own darwin baseline and FAILS those stories once with "No existing
//    reference screenshot found; a new one was created" — the second run
//    passes. The real verdict comes from CI.
//
//    Width is the first thing to check on a failed golden: the boards are
//    captured 1:1 in the 1200 px viewport the Storybook plugin sets, so they
//    are 1200 px wide (vitest 4 shot a downscaled iframe — 960 px; #424).
//    414 px means the plugin never applied its viewport (#220) — a broken
//    runner, not a design change: never regenerate on that.
//
// 2. Updating a baseline is a DECISION, not a chore. When a golden fails,
//    look at the `visual-baselines` artifact CI attaches to the failed run:
//    it holds both the diffs and freshly regenerated Linux baselines. If the
//    change was intended, download it and commit those PNGs in the SAME PR
//    that changed the design. Never "regenerate until green".
// Как выглядит упавший голден на vitest 5 (CI, прогон 37914796719, #424):
// явно и быстро, за ~1 с — «Screenshot does not match the stored reference.»,
// строкой ниже причина («Expected image dimensions to be 960×365px, but
// received 1200×456px»), затем пути: «Reference screenshot» (эталон в
// `__screenshots__/`) и «Actual screenshot» в `.vitest/attachments/` (дифф
// матчер пишет туда же, когда размеры совпали). На vitest 4 (прогон
// 30627486218) расхождение приезжало как «Test timed out in 15000ms» — таймаут
// в golden() больше НЕ типичный признак разошедшегося эталона. Оговорка: на
// vitest 5 пока видели только расхождение по РАЗМЕРУ; расхождение пикселей
// при том же размере ещё не ловилось. Что бы ни пришло — смотрите артефакт
// `visual-baselines`.
export async function golden(element: HTMLElement, name: string) {
  await expect.element(element).toMatchScreenshot(name);
}
