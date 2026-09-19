import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #247 — the Account tab of 0.1.0 (4) died on open. The TestFlight build
// carried no EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, AuthProvider therefore mounted
// no ClerkProvider (its documented "run signed-out rather than crash"
// degradation), and SignInForm called useSignIn()/useSignUp() BEFORE looking
// at the key. Outside the provider every provider-bound Clerk hook throws, and
// an uncaught render error is RCTFatal in a release build.
//
// These cases pin the order that fixes it: without a key the form renders the
// «unavailable» state and calls NOT ONE Clerk hook; with a key the form itself
// renders, through the hooks. Rendered with react-dom/server on
// react-native-web (the `mobile` vitest project aliases `react-native` to it),
// so this is the real component tree, not a description of it.

// The provider-bound hooks as they behave outside <ClerkProvider>: they throw.
// The message is @clerk/react's own (useAssertWrappedByClerkProvider), so a
// regression fails with the same text the crashing device would have shown.
const OUTSIDE_PROVIDER =
  "@clerk/react: useClerkSignal can only be used within the <ClerkProvider /> component.";
const useSignIn = vi.fn((): unknown => {
  throw new Error(OUTSIDE_PROVIDER);
});
const useSignUp = vi.fn((): unknown => {
  throw new Error(OUTSIDE_PROVIDER);
});

vi.mock("@clerk/expo", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: async () => null }),
  useSignIn: () => useSignIn(),
  useSignUp: () => useSignUp(),
}));

// Native modules the form's imports reach (keychain, uuid, gradients, glass,
// images, SF Symbols): inert stand-ins, nothing here is under test.
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

const props = {
  kicker: "Watch for free",
  headline: "Create your account",
  bodyText: "Create a free account to start watching.",
  cta: "Create free account",
  onDone: () => undefined,
};

// The key is read once, at module load (auth/clerk.tsx), exactly as a build
// inlines it — so each case loads the component fresh under its own env.
async function loadSignInForm() {
  vi.resetModules();
  const mod = await import("@/components/sign-in-form");
  return mod.SignInForm;
}

// The first import pulls react-native-web and the app's component tree cold;
// under `pnpm test:coverage` (v8 instrumentation, the whole suite in
// parallel) that alone has taken >5s — the default per-test budget — while
// the cases themselves render in milliseconds.
const COLD_IMPORT_TIMEOUT_MS = 60_000;

describe("SignInForm — the Clerk-key gate (#247)", { timeout: COLD_IMPORT_TIMEOUT_MS }, () => {
  beforeEach(() => {
    // React Native's global; the api client reads it at module load.
    vi.stubGlobal("__DEV__", false);
    useSignIn.mockClear();
    useSignUp.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("without a publishable key renders the unavailable state and calls no Clerk hook", async () => {
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", undefined);
    const SignInForm = await loadSignInForm();

    const html = renderToString(<SignInForm {...props} />);

    expect(html).toContain("Sign-in unavailable");
    expect(html).toContain("This build has no Clerk publishable key configured.");
    expect(html).not.toContain(props.headline);
    expect(useSignIn).not.toHaveBeenCalled();
    expect(useSignUp).not.toHaveBeenCalled();
  });

  it("with a publishable key renders the email step through the Clerk hooks", async () => {
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_dummy");
    useSignIn.mockImplementation(() => ({ signIn: {} }));
    useSignUp.mockImplementation(() => ({ signUp: {} }));
    const SignInForm = await loadSignInForm();

    const html = renderToString(<SignInForm {...props} />);

    expect(html).toContain(props.headline);
    expect(html).toContain(props.cta);
    expect(html).not.toContain("Sign-in unavailable");
    expect(useSignIn).toHaveBeenCalledTimes(1);
    expect(useSignUp).toHaveBeenCalledTimes(1);
  });
});
