/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #253 — the Account tab of 0.1.0 (5) spun forever. The build carried the
// key, but the production Clerk instance answered 400 native_api_disabled
// (#251), clerk-js's load() rejected, and `useAuth().isLoaded` — the only
// thing the tab looked at — never became true. The same spinner greets a
// dead network or a Clerk outage.
//
// These cases render the real AccountScreen through useOptionalAuth() (the
// hook under test), in jsdom on react-native-web with react-dom/client, so
// effects run and fake timers drive the wait. The `mobile` vitest project
// aliases `react-native` to react-native-web and resolves react/react-dom
// from mobile/node_modules (one React). The screen lives under app/, which
// is expo-router's route tree — a *.test.tsx there would become a route —
// so the test sits next to the hook it exercises.

// @clerk/expo as the app sees it: `useAuth` and `useClerk` under a mounted
// provider, with the load state scripted per case. `on`/`off` are the typed
// status listeners the hook subscribes; `loadHeadlessClerk` is the provider's
// internal reload the hook feature-detects — optional here so one case can
// delete it, the way a future @clerk/react could.
const auth = { isLoaded: false, isSignedIn: false };
const loadHeadlessClerk = vi.fn();
const clerk: {
  status: "loading" | "error" | "ready" | "degraded";
  on: ReturnType<typeof vi.fn<(event: string, handler: (status: string) => void) => void>>;
  off: ReturnType<typeof vi.fn>;
  loadHeadlessClerk?: typeof loadHeadlessClerk;
  signOut: () => Promise<void>;
} = {
  status: "loading",
  on: vi.fn(),
  off: vi.fn(),
  loadHeadlessClerk,
  signOut: async () => undefined,
};

vi.mock("@clerk/expo", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ ...auth, getToken: async () => null }),
  useClerk: () => clerk,
  useUser: () => ({ user: null }),
  useSignIn: () => ({ signIn: {} }),
  useSignUp: () => ({ signUp: {} }),
}));

// The navigation and native modules the Account graph reaches: inert
// stand-ins, none of them under test.
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
  useFocusEffect: () => undefined,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: async () => ({}) }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: { children?: unknown }) => children ?? null,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
// The build number (src/build.ts, via the config provider's floor check).
vi.mock("expo-constants", () => ({ default: { nativeBuildVersion: "6" } }));

const STALLED_TITLE = "Sign-in is unavailable right now";
const STALLED_BODY = "Check your connection and try again.";
const RETRY = "Try again";
const WHY_CARD = "Your progress, on every device";
const SIGNED_OUT_HEADLINE = "Create your account";

// The key is read once, at module load (auth/clerk.tsx), exactly as a build
// inlines it — so each case loads the screen fresh under its own env.
async function loadAccountScreen() {
  vi.resetModules();
  const mod = await import("@/app/(tabs)/account");
  return mod.default;
}

let container: HTMLDivElement;
let root: Root | null = null;

function render(element: React.ReactElement) {
  root = createRoot(container);
  act(() => root?.render(element));
}

const text = () => container.textContent ?? "";
const spinning = () => container.querySelector('[role="progressbar"]') !== null;

// Presses a react-native-web Pressable by its label: the click bubbles from
// the Text up to the Pressable's element, where RNW's responder fires onPress.
function press(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// The first import pulls react-native-web and the app's component tree cold
// (see sign-in-form.test.tsx); the cases themselves render in milliseconds.
const COLD_IMPORT_TIMEOUT_MS = 60_000;

describe("AccountScreen — a Clerk that will not load (#253)", { timeout: COLD_IMPORT_TIMEOUT_MS }, () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("__DEV__", false);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_dummy");
    auth.isLoaded = false;
    auth.isSignedIn = false;
    clerk.status = "loading";
    clerk.on.mockClear();
    clerk.off.mockClear();
    clerk.loadHeadlessClerk = loadHeadlessClerk;
    loadHeadlessClerk.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("spins while Clerk is still loading, then gives up after the timeout", async () => {
    const AccountScreen = await loadAccountScreen();
    render(<AccountScreen />);

    expect(spinning()).toBe(true);
    expect(text()).not.toContain(STALLED_TITLE);
    expect(clerk.on).toHaveBeenCalledWith("status", expect.any(Function));

    act(() => {
      vi.advanceTimersByTime(7_999);
    });
    expect(spinning()).toBe(true);
    expect(text()).not.toContain(STALLED_TITLE);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spinning()).toBe(false);
    expect(text()).toContain(STALLED_TITLE);
    expect(text()).toContain(STALLED_BODY);
    expect(text()).toContain(RETRY);
    expect(text()).toContain(WHY_CARD);
  });

  it("gives up at once when Clerk itself reports an error — no eight-second wait", async () => {
    clerk.status = "error";
    const AccountScreen = await loadAccountScreen();
    render(<AccountScreen />);

    expect(spinning()).toBe(false);
    expect(text()).toContain(STALLED_TITLE);
    expect(text()).toContain(RETRY);
  });

  it("gives up when the error arrives after mount, through the status listener", async () => {
    const AccountScreen = await loadAccountScreen();
    render(<AccountScreen />);
    expect(spinning()).toBe(true);

    const handler = clerk.on.mock.calls.at(-1)?.[1];
    act(() => handler?.("error"));

    expect(spinning()).toBe(false);
    expect(text()).toContain(STALLED_TITLE);
  });

  it("renders the screen once Clerk has loaded, and arms no timer", async () => {
    auth.isLoaded = true;
    const AccountScreen = await loadAccountScreen();
    render(<AccountScreen />);

    expect(spinning()).toBe(false);
    expect(text()).toContain(SIGNED_OUT_HEADLINE);
    expect(text()).not.toContain(STALLED_TITLE);
    expect(vi.getTimerCount()).toBe(0);
    expect(clerk.on).not.toHaveBeenCalled();
  });

  it("retry asks Clerk to load again and waits afresh — the stale error is not trusted", async () => {
    clerk.status = "error";
    const AccountScreen = await loadAccountScreen();
    render(<AccountScreen />);
    expect(text()).toContain(STALLED_TITLE);

    press(RETRY);

    // Clerk's status getter still says "error" (it never re-emits "loading"
    // on a reload), yet the screen is waiting again, not stuck on the old verdict.
    expect(loadHeadlessClerk).toHaveBeenCalledTimes(1);
    expect(spinning()).toBe(true);
    expect(text()).not.toContain(STALLED_TITLE);
    expect(clerk.off).toHaveBeenCalled();
    expect(clerk.on).toHaveBeenCalledTimes(2);

    // A failed retry is caught by the listener the new attempt registered…
    const handler = clerk.on.mock.calls.at(-1)?.[1];
    act(() => handler?.("error"));
    expect(text()).toContain(STALLED_TITLE);

    // …and a retry that neither succeeds nor fails, by the fresh timer.
    press(RETRY);
    expect(spinning()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(text()).toContain(STALLED_TITLE);
    expect(loadHeadlessClerk).toHaveBeenCalledTimes(2);
  });

  it("without the internal reload, retry is only a fresh wait — no throw, unavailable again after 8 s", async () => {
    // A future @clerk/react that renames or drops loadHeadlessClerk: the
    // feature-detect must degrade to the spec's fallback (a new timer), never
    // to a TypeError in the press handler.
    delete clerk.loadHeadlessClerk;
    clerk.status = "error";
    const AccountScreen = await loadAccountScreen();
    render(<AccountScreen />);
    expect(text()).toContain(STALLED_TITLE);

    expect(() => press(RETRY)).not.toThrow();
    expect(loadHeadlessClerk).not.toHaveBeenCalled();
    expect(spinning()).toBe(true);
    expect(text()).not.toContain(STALLED_TITLE);

    act(() => {
      vi.advanceTimersByTime(7_999);
    });
    expect(spinning()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spinning()).toBe(false);
    expect(text()).toContain(STALLED_TITLE);
    expect(text()).toContain(RETRY);
  });

  it("without a publishable key nothing changes: the #247 unavailable state, no timer, no Clerk", async () => {
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", undefined);
    const AccountScreen = await loadAccountScreen();
    render(<AccountScreen />);

    expect(text()).toContain("Sign-in unavailable");
    expect(text()).toContain(WHY_CARD);
    expect(text()).not.toContain(STALLED_TITLE);
    expect(vi.getTimerCount()).toBe(0);
    expect(clerk.on).not.toHaveBeenCalled();
  });
});
