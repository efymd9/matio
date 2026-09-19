/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #252 — the orientation policy. The app is portrait everywhere except the
// landscape player: a horizontal show locks LANDSCAPE while its watch screen
// is mounted and hands PORTRAIT_UP back on unmount; a vertical show asserts
// PORTRAIT_UP; a show that has not loaded yet locks nothing. These cases pin
// WHICH lock is taken WHEN — the calls that reach expo-screen-orientation —
// with the hook mounted in a real React tree (react-dom/client under jsdom),
// because the lock lives in an effect and its release in the effect's cleanup.

// The native module as the hook sees it: the enum the hook reads its values
// from, and lockAsync as a spy whose outcome each case controls. Hoisted with
// the mock — vi.mock is lifted above every import, this has to be too.
const { lockAsync, OrientationLock } = vi.hoisted(() => ({
  lockAsync: vi.fn<(lock: number) => Promise<void>>(async () => undefined),
  OrientationLock: {
    DEFAULT: 0,
    ALL: 1,
    PORTRAIT: 2,
    PORTRAIT_UP: 3,
    PORTRAIT_DOWN: 4,
    LANDSCAPE: 5,
    LANDSCAPE_LEFT: 6,
    LANDSCAPE_RIGHT: 7,
    OTHER: 8,
    UNKNOWN: 9,
  } as const,
}));

vi.mock("expo-screen-orientation", () => ({ OrientationLock, lockAsync }));

import {
  lockOrientation,
  ORIENTATION_GRACE_MS,
  orientationLockFor,
  PORTRAIT_LOCK,
  useOrientationLock,
  useOrientationSettled,
} from "@/orientation";
import type { ShowOrientation } from "@/shared/api-types";

function Screen({ orientation }: { orientation: ShowOrientation | null }) {
  useOrientationLock(orientation);
  return null;
}

// Renders the settled flag as text, so a case reads it off the container.
function Settled({ orientation }: { orientation: ShowOrientation | null }) {
  return <span>{useOrientationSettled(orientation) ? "settled" : "waiting"}</span>;
}

// The window react-native-web's useWindowDimensions reads. jsdom has no
// visualViewport, so RNW falls back to documentElement.clientWidth/Height —
// which jsdom leaves at 0 (no layout); the case defines them, then fires
// the `resize` RNW listens to.
function setWindow(width: number, height: number) {
  const docEl = document.documentElement;
  Object.defineProperty(docEl, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(docEl, "clientHeight", { configurable: true, get: () => height });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

// React's act() gate: set once, before the first render.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(orientation: ShowOrientation | null) {
  act(() => root.render(<Screen orientation={orientation} />));
}

// The calls in order, by enum name — readable failures.
function locks(): string[] {
  const byValue = Object.fromEntries(
    Object.entries(OrientationLock).map(([name, value]) => [value, name]),
  );
  return lockAsync.mock.calls.map(([lock]) => byValue[lock] ?? String(lock));
}

describe("orientation policy (#252)", () => {
  beforeEach(() => {
    lockAsync.mockClear();
    lockAsync.mockImplementation(async () => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("maps a horizontal show to LANDSCAPE (both sides) and a vertical one to PORTRAIT_UP", () => {
    expect(orientationLockFor("horizontal")).toBe(OrientationLock.LANDSCAPE);
    expect(orientationLockFor("vertical")).toBe(OrientationLock.PORTRAIT_UP);
    expect(PORTRAIT_LOCK).toBe(OrientationLock.PORTRAIT_UP);
  });

  it("a horizontal show locks landscape on mount and restores portrait on unmount", () => {
    render("horizontal");
    expect(locks()).toEqual(["LANDSCAPE"]);

    act(() => root.unmount());
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);
  });

  it("a vertical show asserts portrait — and still restores portrait on unmount", () => {
    render("vertical");
    expect(locks()).toEqual(["PORTRAIT_UP"]);

    act(() => root.unmount());
    expect(locks()).toEqual(["PORTRAIT_UP", "PORTRAIT_UP"]);
  });

  it("locks nothing while the show is loading, then landscape once it arrives, exactly once", () => {
    render(null);
    expect(lockAsync).not.toHaveBeenCalled();

    render("horizontal");
    expect(locks()).toEqual(["LANDSCAPE"]);

    // A re-render with the same show is not a second lock.
    render("horizontal");
    expect(locks()).toEqual(["LANDSCAPE"]);
  });

  it("unmounting a screen that never loaded a show releases nothing", () => {
    render(null);
    act(() => root.unmount());
    expect(lockAsync).not.toHaveBeenCalled();
  });

  it("a lock the device refuses is swallowed — the screen keeps rendering", async () => {
    lockAsync.mockImplementation(async () => {
      throw new Error("UnsupportedOrientationLock");
    });
    // An unhandled rejection here would fail the run (vitest reports it);
    // the assertion is that the microtask drains clean.
    expect(() => lockOrientation(OrientationLock.LANDSCAPE)).not.toThrow();
    expect(() => render("horizontal")).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(lockAsync).toHaveBeenCalledTimes(2);
  });
});

// The hold-back: the watch screen mounts the feed only once the window has
// the show's shape — a FlatList mounted in the wrong one drops and re-creates
// its page on the resize — or once the grace period is over (an iPad ignores
// the lock, a device may refuse it). jsdom's window is landscape (1024×768)
// unless a case says otherwise.
describe("useOrientationSettled (#252)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setWindow(1024, 768);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function show(orientation: ShowOrientation | null) {
    act(() => root.render(<Settled orientation={orientation} />));
    return () => container.textContent;
  }

  it("a horizontal show in a landscape window is settled at once — no timer involved", () => {
    const read = show("horizontal");
    expect(read()).toBe("settled");
  });

  it("a vertical show in a landscape window waits, then mounts after the grace period", () => {
    const read = show("vertical");
    expect(read()).toBe("waiting");

    act(() => {
      vi.advanceTimersByTime(ORIENTATION_GRACE_MS - 1);
    });
    expect(read()).toBe("waiting");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(read()).toBe("settled");
  });

  it("settles the moment the window takes the show's shape — the rotation, not the timer", () => {
    setWindow(390, 844);
    const read = show("horizontal");
    expect(read()).toBe("waiting");

    setWindow(844, 390);
    expect(read()).toBe("settled");
  });

  it("a vertical show in a portrait window is settled at once", () => {
    setWindow(390, 844);
    const read = show("vertical");
    expect(read()).toBe("settled");
  });

  it("no show, no settling — not even after the grace period", () => {
    const read = show(null);
    expect(read()).toBe("waiting");
    act(() => {
      vi.advanceTimersByTime(ORIENTATION_GRACE_MS * 2);
    });
    expect(read()).toBe("waiting");
  });

  it("remembers an elapsed grace per shape: the same shape again mounts at once, another waits its own", () => {
    // A portrait window that never turns (an iPad): the first horizontal
    // show waits the grace out…
    setWindow(390, 844);
    const read = show("horizontal");
    expect(read()).toBe("waiting");
    act(() => {
      vi.advanceTimersByTime(ORIENTATION_GRACE_MS);
    });
    expect(read()).toBe("settled");

    // …a reload and another horizontal show does not wait again — the lock
    // that was ignored once will be ignored again…
    show(null);
    expect(read()).toBe("waiting");
    show("horizontal");
    expect(read()).toBe("settled");

    // …but a vertical show in a landscape window is a different question,
    // with its own period.
    setWindow(844, 390);
    show("vertical");
    expect(read()).toBe("waiting");
    act(() => {
      vi.advanceTimersByTime(ORIENTATION_GRACE_MS);
    });
    expect(read()).toBe("settled");
  });
});
