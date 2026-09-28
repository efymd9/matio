/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #252 — the orientation policy. The app is portrait everywhere except the
// landscape player: a horizontal show locks LANDSCAPE while its watch screen
// is FOCUSED and hands PORTRAIT_UP back the moment it is not — another
// screen pushed over it (sign-in from the wall) or its unmount; a vertical
// show asserts PORTRAIT_UP; a show that has not loaded yet locks nothing.
// These cases pin WHICH lock is taken WHEN — the calls that reach
// expo-screen-orientation — with the hooks mounted in a real React tree
// (react-dom/client under jsdom), because the lock lives in an effect and its
// release in the effect's cleanup.

// The native module as the hook sees it: the enums the hooks read their
// values from, lockAsync as a spy whose outcome each case controls, and the
// orientation-change event (#358) — the end of a rotation, as the root view
// controller reports it — which a case fires with `rotated`. Hoisted with the
// mock — vi.mock is lifted above every import, this has to be too.
const { lockAsync, OrientationLock, Orientation, orientationListeners } = vi.hoisted(() => ({
  lockAsync: vi.fn<(lock: number) => Promise<void>>(async () => undefined),
  Orientation: {
    UNKNOWN: 0,
    PORTRAIT_UP: 1,
    PORTRAIT_DOWN: 2,
    LANDSCAPE_LEFT: 3,
    LANDSCAPE_RIGHT: 4,
  } as const,
  orientationListeners: new Set<(event: { orientationInfo: { orientation: number } }) => void>(),
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

vi.mock("expo-screen-orientation", () => ({
  OrientationLock,
  Orientation,
  lockAsync,
  addOrientationChangeListener(listener: (event: { orientationInfo: { orientation: number } }) => void) {
    orientationListeners.add(listener);
    return { remove: () => orientationListeners.delete(listener) };
  },
}));

// Navigation focus, as expo-router's useFocusEffect delivers it: the effect
// runs on focus (and at once when mounted focused), its cleanup runs on blur
// and on unmount. The fake keeps that contract and lets a case push a screen
// over ours (`blur`) and pop it again (`focus`).
const nav = vi.hoisted(() => {
  const listeners = new Set<(focused: boolean) => void>();
  const state = { focused: true, listeners };
  return {
    ...state,
    set(focused: boolean) {
      nav.focused = focused;
      listeners.forEach((listener) => listener(focused));
    },
  };
});

vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    useFocusEffect(effect: () => undefined | (() => void)) {
      React.useEffect(() => {
        let cleanup: undefined | (() => void);
        let isFocused = false;
        const run = () => {
          cleanup = effect();
          isFocused = true;
        };
        if (nav.focused) run();
        const listener = (focused: boolean) => {
          if (focused) {
            if (isFocused) return;
            cleanup?.();
            run();
          } else {
            cleanup?.();
            cleanup = undefined;
            isFocused = false;
          }
        };
        nav.listeners.add(listener);
        return () => {
          cleanup?.();
          nav.listeners.delete(listener);
        };
      }, [effect]);
    },
  };
});

import {
  LEAVE_ROTATION_TIMEOUT_MS,
  lockOrientation,
  ORIENTATION_GRACE_MS,
  orientationLockFor,
  PORTRAIT_LOCK,
  resetOrientationLockForTests,
  useLeaveUpright,
  useOrientationLock,
  useOrientationSettled,
  type FocusSession,
} from "@/orientation";
import type { ShowOrientation } from "@/shared/api-types";

// The watch screen's composition: the lock feeds its focus into the
// hold-back, and the text is what the screen would render (feed / spinner).
function Screen({ orientation }: { orientation: ShowOrientation | null }) {
  const focus = useOrientationLock(orientation);
  const settled = useOrientationSettled(orientation, focus);
  return (
    <span>
      {settled ? "settled" : "waiting"}:{focus === null ? "blurred" : `focus${focus}`}
    </span>
  );
}

// The hold-back alone, with the focus given from outside.
function Settled({ orientation, focus }: { orientation: ShowOrientation | null; focus: FocusSession }) {
  return <span>{useOrientationSettled(orientation, focus) ? "settled" : "waiting"}</span>;
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

const text = () => container.textContent;

// Another screen pushed over ours / popped again.
const blur = () => act(() => nav.set(false));
const focus = () => act(() => nav.set(true));

// The calls in order, by enum name — readable failures.
function locks(): string[] {
  const byValue = Object.fromEntries(
    Object.entries(OrientationLock).map(([name, value]) => [value, name]),
  );
  return lockAsync.mock.calls.map(([lock]) => byValue[lock] ?? String(lock));
}

function mountRoot() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
}

function unmountRoot() {
  act(() => root.unmount());
  container.remove();
}

describe("useOrientationLock (#252)", () => {
  beforeEach(() => {
    resetOrientationLockForTests();
    lockAsync.mockClear();
    lockAsync.mockImplementation(async () => undefined);
    nav.focused = true;
    setWindow(1024, 768);
    mountRoot();
  });

  afterEach(unmountRoot);

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

  // #358: the unmount still asks for portrait, but portrait is already the
  // lock last asked of the device — so nothing more reaches it (see
  // "lockOrientation drops a request equal to the last one").
  it("a vertical show asserts portrait — and its unmount asks the device for nothing more", () => {
    render("vertical");
    expect(locks()).toEqual(["PORTRAIT_UP"]);

    act(() => root.unmount());
    expect(locks()).toEqual(["PORTRAIT_UP"]);
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

  // The review's case: /sign-in pushed from the wall is a portrait screen.
  it("a screen pushed over the player releases to portrait; popping it takes landscape again", () => {
    render("horizontal");
    expect(locks()).toEqual(["LANDSCAPE"]);
    expect(text()).toBe("settled:focus1");

    blur();
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);
    expect(text()).toBe("waiting:blurred");

    focus();
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP", "LANDSCAPE"]);
    expect(text()).toBe("settled:focus2");

    // And the unmount cleanup is still there after all that.
    act(() => root.unmount());
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP", "LANDSCAPE", "PORTRAIT_UP"]);
  });

  it("a show that arrives while another screen is on top locks nothing until focus returns", () => {
    render(null);
    blur();
    render("horizontal");
    expect(lockAsync).not.toHaveBeenCalled();

    focus();
    expect(locks()).toEqual(["LANDSCAPE"]);
  });

  it("a lock the device refuses is swallowed — the screen keeps rendering", async () => {
    lockAsync.mockImplementation(async () => {
      throw new Error("UnsupportedOrientationLock");
    });
    // An unhandled rejection here would fail the run (vitest reports it);
    // the assertion is that the microtask drains clean.
    expect(() => lockOrientation(OrientationLock.LANDSCAPE)).not.toThrow();
    // …and a refused lock is not remembered as asked (#358): once the
    // refusal has come back, the same lock reaches the device again.
    await act(async () => {
      await Promise.resolve();
    });
    expect(() => render("horizontal")).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(lockAsync).toHaveBeenCalledTimes(2);
  });
});

// #358 — a lock equal to the last one asked of the device is dropped: the
// module would still ask UIKit for a geometry update, and a stray one must
// never start a rotation in the middle of a transition.
describe("lockOrientation drops a request equal to the last one (#358)", () => {
  beforeEach(() => {
    resetOrientationLockForTests();
    lockAsync.mockClear();
    lockAsync.mockImplementation(async () => undefined);
  });

  it("a repeated lock never reaches the device; a different one always does", () => {
    lockOrientation(OrientationLock.LANDSCAPE);
    lockOrientation(OrientationLock.LANDSCAPE);
    expect(locks()).toEqual(["LANDSCAPE"]);

    lockOrientation(OrientationLock.PORTRAIT_UP);
    lockOrientation(OrientationLock.PORTRAIT_UP);
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);

    // Only the LAST request counts: landscape again is a real change.
    lockOrientation(OrientationLock.LANDSCAPE);
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP", "LANDSCAPE"]);
  });

  it("the root layout's launch lock and a vertical show's are one request, not two", () => {
    // app/_layout.tsx locks portrait at launch; the watch screen of a
    // vertical show then asks for the same thing.
    lockOrientation(PORTRAIT_LOCK);
    lockOrientation(orientationLockFor("vertical"));
    expect(locks()).toEqual(["PORTRAIT_UP"]);
  });
});

// The hold-back: the feed is mounted only while the screen is focused AND
// the window has the show's shape — a FlatList mounted in the wrong one, or
// resized under a screen pushed over it, drops and re-creates its page — or
// once the grace period of this focus is over (an iPad ignores the lock, a
// device may refuse it). jsdom's window is landscape (1024×768) unless a case
// says otherwise.
describe("useOrientationSettled (#252)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetOrientationLockForTests();
    lockAsync.mockClear();
    lockAsync.mockImplementation(async () => undefined);
    nav.focused = true;
    setWindow(1024, 768);
    mountRoot();
  });

  afterEach(() => {
    unmountRoot();
    vi.useRealTimers();
  });

  function settledOnly(orientation: ShowOrientation | null, focus: FocusSession) {
    act(() => root.render(<Settled orientation={orientation} focus={focus} />));
  }

  const elapse = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it("a horizontal show in a landscape window is settled at once — no timer involved", () => {
    settledOnly("horizontal", 1);
    expect(text()).toBe("settled");
  });

  it("a vertical show in a landscape window waits, then mounts after the grace period", () => {
    settledOnly("vertical", 1);
    expect(text()).toBe("waiting");

    elapse(ORIENTATION_GRACE_MS - 1);
    expect(text()).toBe("waiting");

    elapse(1);
    expect(text()).toBe("settled");
  });

  it("settles the moment the window takes the show's shape — the rotation, not the timer", () => {
    setWindow(390, 844);
    settledOnly("horizontal", 1);
    expect(text()).toBe("waiting");

    setWindow(844, 390);
    expect(text()).toBe("settled");
  });

  it("a vertical show in a portrait window is settled at once", () => {
    setWindow(390, 844);
    settledOnly("vertical", 1);
    expect(text()).toBe("settled");
  });

  it("no show, or no focus, means no feed — not even after the grace period", () => {
    settledOnly(null, 1);
    elapse(ORIENTATION_GRACE_MS * 2);
    expect(text()).toBe("waiting");

    settledOnly("horizontal", null);
    elapse(ORIENTATION_GRACE_MS * 2);
    expect(text()).toBe("waiting");
  });

  it("the feed is taken down while another screen is on top and comes back on focus", () => {
    render("horizontal");
    expect(text()).toBe("settled:focus1");

    // The blur releases the lock: the window turns portrait under the pushed
    // screen. The feed must already be gone — unsettled on the blur itself,
    // before any resize, whatever shape the window has.
    blur();
    expect(text()).toBe("waiting:blurred");
    setWindow(390, 844);
    expect(text()).toBe("waiting:blurred");

    // Focus: the lock is taken again, the feed waits for the rotation…
    focus();
    expect(text()).toBe("waiting:focus2");
    // …and is back the moment the window is landscape again.
    setWindow(844, 390);
    expect(text()).toBe("settled:focus2");
  });

  it("each focus gets its own grace: one that ran out before the blur is not inherited", () => {
    // A portrait window that never turns (a refused lock): the first focus
    // waits the grace out…
    setWindow(390, 844);
    render("horizontal");
    expect(text()).toBe("waiting:focus1");
    elapse(ORIENTATION_GRACE_MS);
    expect(text()).toBe("settled:focus1");

    // …a screen over the player, then back: the new focus waits its own.
    blur();
    focus();
    expect(text()).toBe("waiting:focus2");
    elapse(ORIENTATION_GRACE_MS);
    expect(text()).toBe("settled:focus2");
  });
});

// #358 — the back from the landscape player. The portrait lock taken by the
// watch screen's UNMOUNT lands in the middle of the native pop, and on iOS
// that rotation strands the transition: a frozen, stretched snapshot of the
// player over a window that no longer takes touches (TestFlight 0.1.0 (7)).
// So the back turns upright FIRST — the feed unmounted and portrait asked
// for while the screen is still focused — and pops once that rotation has
// FINISHED (or after a timeout); after the pop nothing reaches the device.
describe("useLeaveUpright (#358)", () => {
  // The watch screen's composition: the leave feeds the lock and the
  // hold-back as «no show». The button is the «‹»; the text is what the
  // screen renders (the feed, or the spinner).
  function Leaving({ orientation, back }: { orientation: ShowOrientation; back: () => void }) {
    const { leaving, requestLeave } = useLeaveUpright(back);
    const lockFor = leaving ? null : orientation;
    const focus = useOrientationLock(lockFor);
    const settled = useOrientationSettled(lockFor, focus);
    return (
      <button type="button" onClick={requestLeave}>
        {settled ? "feed" : "waiting"}
      </button>
    );
  }

  let back: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetOrientationLockForTests();
    lockAsync.mockClear();
    lockAsync.mockImplementation(async () => undefined);
    orientationListeners.clear();
    nav.focused = true;
    back = vi.fn<() => void>();
    mountRoot();
  });

  afterEach(() => {
    unmountRoot();
    vi.useRealTimers();
  });

  function renderLeaving(orientation: ShowOrientation) {
    act(() => root.render(<Leaving orientation={orientation} back={back} />));
  }

  const pressBack = () =>
    act(() => {
      container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  const elapse = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  // A rotation has finished: the event the root view controller sends from
  // its transition coordinator's completion.
  const rotated = (orientation: number) =>
    act(() => {
      orientationListeners.forEach((listener) => listener({ orientationInfo: { orientation } }));
    });

  // The pop: the route leaves the tree.
  function pop() {
    act(() => root.unmount());
    root = createRoot(container);
  }

  it("landscape: the feed comes down and portrait is asked for BEFORE the pop, which waits for the rotation to finish", () => {
    setWindow(844, 390);
    renderLeaving("horizontal");
    expect(text()).toBe("feed");
    expect(locks()).toEqual(["LANDSCAPE"]);

    pressBack();
    // Still on the watch screen, still focused: the feed is gone, portrait
    // is on its way — and nothing has popped.
    expect(text()).toBe("waiting");
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);
    expect(back).not.toHaveBeenCalled();

    // The window reports its portrait size as the rotation BEGINS — too
    // early: a pop now would still overlap the rotation.
    setWindow(390, 844);
    expect(back).not.toHaveBeenCalled();

    // A second tap while the phone turns is not a second pop.
    pressBack();
    expect(back).not.toHaveBeenCalled();

    // The rotation is over: now the pop, exactly once.
    rotated(Orientation.PORTRAIT_UP);
    expect(back).toHaveBeenCalledTimes(1);
    rotated(Orientation.PORTRAIT_UP);
    elapse(LEAVE_ROTATION_TIMEOUT_MS * 2);
    expect(back).toHaveBeenCalledTimes(1);

    // The pop unmounts the screen: the device hears nothing more while the
    // native transition runs — the portrait lock was taken before it — and
    // the screen stops listening.
    const asked = lockAsync.mock.calls.length;
    pop();
    expect(lockAsync).toHaveBeenCalledTimes(asked);
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);
    expect(orientationListeners.size).toBe(0);
  });

  it("the end of a LANDSCAPE rotation (the one that opened the player, reported late) does not pop", () => {
    setWindow(844, 390);
    renderLeaving("horizontal");
    pressBack();

    rotated(Orientation.LANDSCAPE_LEFT);
    rotated(Orientation.LANDSCAPE_RIGHT);
    expect(back).not.toHaveBeenCalled();

    rotated(Orientation.PORTRAIT_UP);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("a rotation that never ends (a refused lock) still pops, once, after the timeout", () => {
    setWindow(844, 390);
    renderLeaving("horizontal");
    pressBack();
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);

    elapse(LEAVE_ROTATION_TIMEOUT_MS - 1);
    expect(back).not.toHaveBeenCalled();

    elapse(1);
    expect(back).toHaveBeenCalledTimes(1);

    // Neither more time nor a late end of the rotation pops a second time.
    elapse(LEAVE_ROTATION_TIMEOUT_MS * 3);
    setWindow(390, 844);
    rotated(Orientation.PORTRAIT_UP);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("a vertical show pops at once — nothing to turn, no landscape↔portrait churn", () => {
    setWindow(390, 844);
    renderLeaving("vertical");
    expect(text()).toBe("feed");
    expect(locks()).toEqual(["PORTRAIT_UP"]);

    pressBack();
    expect(back).toHaveBeenCalledTimes(1);
    // The release asked for the portrait the device already has — dropped.
    expect(locks()).toEqual(["PORTRAIT_UP"]);
    expect(orientationListeners.size).toBe(0);

    const asked = lockAsync.mock.calls.length;
    pop();
    expect(lockAsync).toHaveBeenCalledTimes(asked);
  });

  it("nothing leaves until Back is pressed", () => {
    setWindow(844, 390);
    renderLeaving("horizontal");
    setWindow(390, 844);
    rotated(Orientation.PORTRAIT_UP);
    elapse(LEAVE_ROTATION_TIMEOUT_MS * 2);
    expect(back).not.toHaveBeenCalled();
  });
});
