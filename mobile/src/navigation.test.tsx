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
const clerk = {
  status: "ready",
  on: () => undefined,
  off: () => undefined,
  client: { signIn: { id: "sia_before" }, signUp: { id: "sua_before" } },
  setActive: vi.fn(async (_params: { session: string }) => undefined),
};
vi.mock("@clerk/expo", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ ...auth, getToken: async () => null }),
  useClerk: () => clerk,
  useSignIn: () => ({ signIn }),
  useSignUp: () => ({ signUp }),
}));

// #277 — Sign in with Apple under the form: the server's lever on, the
// device saying yes, the platform iOS, and Clerk's Apple flow a spy. The
// system button is drawn as a plain pressable (sign-in-form.test.tsx pins
// its looks; here only where its success leads matters).
const social = vi.hoisted(() => ({
  lever: undefined as undefined | { apple: boolean; google: boolean },
  appleStart: vi.fn(async (): Promise<{ createdSessionId: string | null }> => ({ createdSessionId: null })),
}));
vi.mock("@clerk/expo/apple", () => ({
  useSignInWithApple: () => ({ startAppleAuthenticationFlow: social.appleStart }),
}));
vi.mock("@clerk/expo/google", () => ({
  useSignInWithGoogle: () => ({ startGoogleAuthenticationFlow: async () => ({ createdSessionId: null }) }),
}));
vi.mock("expo-apple-authentication", async () => {
  const { Pressable, Text } = await import("react-native");
  return {
    isAvailableAsync: async () => true,
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 0 },
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>Continue with Apple</Text>
      </Pressable>
    ),
  };
});
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  return { ...rn, Platform: { ...rn.Platform, OS: "ios" } };
});

// The show the frame over the form comes from (#277, board B): the same
// /v1/shows read the show page makes.
const showRead = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      show: async (slug: string) => {
        showRead.calls.push(slug);
        return {
          slug,
          heroImageUrl: null,
          posterImageUrl: null,
          episodes: [
            { id: "ep-1", title: "The Vow" },
            { id: "ep-2", title: "Ash" },
            { id: "ep-3", title: "Sealed in Blood" },
          ],
        };
      },
    },
  };
});

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
// The form's Terms / Privacy line (#312): the legal URLs and the in-app
// browser its links open — inert here, tested in sign-in-form.test.tsx.
vi.mock("@/api/config-context", () => ({
  useConfig: () => ({
    urls: {
      terms: "https://matio.tv/terms?embed=app",
      privacy: "https://matio.tv/privacy?embed=app",
    },
    socialSignIn: social.lever,
  }),
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: async () => ({}) }));

const EPISODE = { episodeId: "ep-3", showSlug: "the-scarlet-oath" };
const WATCH_EPISODE = { pathname: "/watch/[episodeId]", params: EPISODE };

async function loadScreen() {
  vi.resetModules();
  return (await import("@/app/sign-in")).default;
}

let container: HTMLDivElement;
let root: Root | null = null;
let Screen: Awaited<ReturnType<typeof loadScreen>>;

const text = () => container.textContent ?? "";

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
    social.lever = undefined;
    social.appleStart.mockReset().mockImplementation(async () => ({ createdSessionId: null }));
    clerk.setActive.mockClear();
    showRead.calls = [];
    Screen = await loadScreen();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    // Back to jsdom's own (prototype) clientHeight.
    Reflect.deleteProperty(document.documentElement, "clientHeight");
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

  // Lets the device's Apple answer and the show read land.
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  // react-native-web's window height is the root element's clientHeight
  // (jsdom: 0 until told), re-read on `resize`.
  function setWindowHeight(height: number) {
    act(() => {
      Object.defineProperty(document.documentElement, "clientHeight", {
        value: height,
        configurable: true,
      });
      window.dispatchEvent(new Event("resize"));
    });
  }

  it("Sign in with Apple from a locked episode lands IN that episode — the same replace as the code (#277)", async () => {
    params = EPISODE;
    social.lever = { apple: true, google: false };
    social.appleStart.mockResolvedValueOnce({ createdSessionId: "sess_apple" });
    render();
    await settle();

    await press("Continue with Apple");

    expect(clerk.setActive).toHaveBeenCalledWith({ session: "sess_apple" });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(WATCH_EPISODE);
    expect(router.back).not.toHaveBeenCalled();
  });

  it("a locked episode's screen opens under the show's frame, the episode beside the kicker (#277, board B)", async () => {
    params = EPISODE;
    render();
    await settle();

    expect(container.querySelector('[data-testid="show-frame"]')).not.toBeNull();
    expect(showRead.calls).toEqual(["the-scarlet-oath"]);
    expect(text()).toContain("Ep. 3 · Sealed in Blood");
  });

  it("the player's own wall names no show: no frame, nothing read", async () => {
    render();
    await settle();

    expect(container.querySelector('[data-testid="show-frame"]')).toBeNull();
    expect(showRead.calls).toEqual([]);
  });

  it("a 375×667 phone gets the smaller frame; a 390×844 phone the board's full one", async () => {
    params = EPISODE;
    const frameHeight = () =>
      getComputedStyle(container.querySelector('[data-testid="show-frame"]') as Element).height;

    setWindowHeight(667);
    render();
    await settle();
    expect(frameHeight()).toBe("160px");

    setWindowHeight(844);
    await settle();
    expect(frameHeight()).toBe("262px");
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
