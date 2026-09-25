/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #288 — the ways out of the sign-in screen. A viewer who taps a locked
// episode on the show page (or Home's Play) and signs in must land IN that
// episode, not back on the list; a viewer Clerk signs in a beat after the
// screen opened (a slow start) must not be left staring at the form; and a
// screen that is the stack's only one (a cold start from a matio:// link)
// must still have a way back. The screen is rendered for real — form
// included — in jsdom on react-native-web, with the router and Clerk faked.
// It lives under app/, expo-router's route tree, where a test file would
// become a route — hence this file sits next to the helper it also covers.

const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
};
let params: Record<string, string | undefined> = {};

vi.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => params,
}));

const auth = { isLoaded: true, isSignedIn: false };
const ok = async () => ({ error: null });
const signIn = { emailCode: { sendCode: vi.fn(ok), verifyCode: vi.fn(ok) }, finalize: vi.fn(ok) };
const signUp = {
  create: vi.fn(ok),
  verifications: { sendEmailCode: vi.fn(ok), verifyEmailCode: vi.fn(ok) },
  finalize: vi.fn(ok),
};
vi.mock("@clerk/expo", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ ...auth, getToken: async () => null }),
  useClerk: () => ({ status: "ready", on: () => undefined, off: () => undefined }),
  useSignIn: () => ({ signIn }),
  useSignUp: () => ({ signUp }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
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

const EPISODE = { episodeId: "ep-3", showSlug: "the-scarlet-oath" };
const WATCH_EPISODE = { pathname: "/watch/[episodeId]", params: EPISODE };

async function loadScreen() {
  vi.resetModules();
  return (await import("@/app/sign-in")).default;
}

let container: HTMLDivElement;
let root: Root | null = null;
let Screen: Awaited<ReturnType<typeof loadScreen>>;

function render() {
  act(() => root?.render(<Screen />));
}

function typeInto(value: string) {
  const input = container.querySelector("input");
  if (!input) throw new Error("no input");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const COLD_IMPORT_TIMEOUT_MS = 60_000;

describe("goBackOrHome", () => {
  it("goes back when there is somewhere to go, else replaces with Home", async () => {
    const { goBackOrHome } = await import("@/navigation");
    const r = { back: vi.fn(), replace: vi.fn(), canGoBack: vi.fn(() => true) };

    goBackOrHome(r);
    expect(r.back).toHaveBeenCalledTimes(1);
    expect(r.replace).not.toHaveBeenCalled();

    r.canGoBack.mockReturnValue(false);
    goBackOrHome(r);
    expect(r.back).toHaveBeenCalledTimes(1);
    expect(r.replace).toHaveBeenCalledWith("/");
  });
});

describe("SignInScreen — where success and «Not now» lead (#288)", { timeout: COLD_IMPORT_TIMEOUT_MS }, () => {
  beforeEach(async () => {
    vi.stubGlobal("__DEV__", false);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_dummy");
    for (const fn of [router.push, router.replace, router.back]) fn.mockClear();
    router.canGoBack.mockReset().mockReturnValue(true);
    params = {};
    auth.isLoaded = true;
    auth.isSignedIn = false;
    Screen = await loadScreen();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("signing in from a locked episode on the show page lands IN that episode", async () => {
    params = EPISODE;
    render();

    typeInto("member@example.com");
    await press("Send code");
    typeInto("123456");
    await press("Sign in");

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(WATCH_EPISODE);
    expect(router.back).not.toHaveBeenCalled();
  });

  it("a session that arrives while the form is open (slow Clerk start) goes on by itself", async () => {
    params = EPISODE;
    auth.isLoaded = false;
    render();
    expect(router.replace).not.toHaveBeenCalled();

    auth.isLoaded = true;
    auth.isSignedIn = true;
    render();

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(WATCH_EPISODE);
  });

  it("navigates once, though the form's success and the session flip both report it", async () => {
    params = EPISODE;
    render();
    typeInto("member@example.com");
    await press("Send code");
    typeInto("123456");
    await press("Sign in");

    // Clerk now reports the session the form just finalized.
    auth.isSignedIn = true;
    render();
    render();

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });

  it("the player's own wall (no episode passed) goes back to the player", async () => {
    render();
    auth.isSignedIn = true;
    render();

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("«Not now» on a screen that is the stack's only one goes Home instead of nowhere", async () => {
    router.canGoBack.mockReturnValue(false);
    params = EPISODE;
    render();

    await press("Not now");

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});
