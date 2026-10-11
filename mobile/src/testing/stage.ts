// TEST-ONLY. A test's own stage — its DOM container, its React root and a
// «still running» flag — for the component tests that re-import the app after
// vi.resetModules() (#439; the harness #435 built for config-context, #432).
// Nothing in the app imports this file, so Metro never bundles it; it lives
// under src/ only so the tests can reach it through the `@/` alias.
//
// vitest does not cancel a test that times out: its continuation keeps
// running in the background. While the container and the root were plain
// module variables, a test stuck on a cold import woke up INSIDE a later
// test — createRoot() on that test's container, its typing and presses on
// that test's form, its act() overlapping that test's act() — and one timeout
// read as a run of misleading failures. So a test opens its stage in
// beforeEach and closes it in afterEach, and the harness takes the stage
// BEFORE its first await and calls stillLive() after each import await: the
// continuation of a test that is already over stops before it touches the
// DOM, React or the spies. A container of its own is not enough by itself —
// a late act() still overlaps the next test's (#435 measured it: 14 of 16
// red with the check switched off).
//
// NOT covered: a test that times out while one of its act() calls is still
// pending (the harness's own, or one in a test body) — that still breaks
// React's act queue for the rest of the file. The cold import is the failure
// seen (#432).
import { act } from "react";
import type { Root } from "react-dom/client";

export type Stage = { container: HTMLDivElement; root: Root | null; live: boolean };

export function openStage(): Stage {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: null, live: true };
}

// The flag goes down first: from here on, a late continuation of this test
// stops at its next stillLive().
export function closeStage(stage: Stage) {
  stage.live = false;
  act(() => stage.root?.unmount());
  stage.root = null;
  stage.container.remove();
}

export function stillLive(own: Stage) {
  if (!own.live) throw new Error("this test is already over (timed out?) — its continuation stops here");
}
