/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AA_TEXT, contrastRatio, paintedBackground, parseColor } from "@/testing/contrast";
import { colors } from "@/theme";

// #247 — the Account tab of 0.1.0 (4) died on open. The TestFlight build
// carried no EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, AuthProvider therefore mounted
// no ClerkProvider (its documented "run signed-out rather than crash"
// degradation), and SignInForm called useSignIn()/useSignUp() BEFORE looking
// at the key. Outside the provider every provider-bound Clerk hook throws, and
// an uncaught render error is RCTFatal in a release build.
//
// The first two cases pin the order that fixes it: without a key the form
// renders the «unavailable» state and calls NOT ONE Clerk hook; with a key the
// form itself renders, through the hooks. Rendered on react-native-web (the
// `mobile` vitest project aliases `react-native` to it), so this is the real
// component tree, not a description of it.
//
// #288 — the flow itself: which Clerk answer sends the form on to create an
// account (only "no such address"), what the viewer reads for every failure
// (their language, never Clerk's English or its developer strings), and that
// a Clerk call that THROWS still ends in a message. Driven through the real
// form in jsdom with react-dom/client: typed into, pressed, awaited.

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

const useClerk = vi.fn((): unknown => {
  throw new Error(OUTSIDE_PROVIDER);
});
vi.mock("@clerk/expo", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: async () => null }),
  useSignIn: () => useSignIn(),
  useSignUp: () => useSignUp(),
  useClerk: () => useClerk(),
}));

// #277 — the Apple / Google buttons. The two Clerk hooks live in their own
// entry points (@clerk/expo/apple, /google) and, like every provider-bound
// hook, throw outside <ClerkProvider>; their flows are spies a case scripts.
// The native Apple module answers «available» as a case says and draws its
// system button as a plain pressable whose props a case can read; the build's
// Google client ids are expo-constants' `extra`; the platform is the one the
// case names (web otherwise, react-native-web's own) — the buttons are
// iOS-only. `social.lever` is what /v1/config reports.
type Flow = {
  createdSessionId: string | null;
  setActive?: (params: { session: string }) => Promise<void>;
  signIn?: { id?: string; status?: string };
  signUp?: { id?: string; status?: string };
};
const social = vi.hoisted(() => ({
  os: "web",
  lever: undefined as undefined | { apple: boolean; google: boolean },
  extra: {} as Record<string, unknown>,
  appleAvailable: vi.fn(async () => true),
  appleStart: vi.fn(async (): Promise<Flow> => ({ createdSessionId: null })),
  googleStart: vi.fn(async (): Promise<Flow> => ({ createdSessionId: null })),
  appleButtonProps: null as null | Record<string, unknown>,
}));
const useSignInWithApple = vi.fn((): unknown => {
  throw new Error(OUTSIDE_PROVIDER);
});
const useSignInWithGoogle = vi.fn((): unknown => {
  throw new Error(OUTSIDE_PROVIDER);
});
vi.mock("@clerk/expo/apple", () => ({ useSignInWithApple: () => useSignInWithApple() }));
vi.mock("@clerk/expo/google", () => ({ useSignInWithGoogle: () => useSignInWithGoogle() }));
vi.mock("expo-apple-authentication", async () => {
  const { Pressable, Text } = await import("react-native");
  return {
    isAvailableAsync: () => social.appleAvailable(),
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: (buttonProps: { onPress: () => void } & Record<string, unknown>) => {
      social.appleButtonProps = buttonProps;
      return (
        <Pressable testID="apple-button" onPress={buttonProps.onPress}>
          <Text>Continue with Apple</Text>
        </Pressable>
      );
    },
  };
});
vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return { extra: social.extra };
    },
  },
}));

// #304 item 1 — what VoiceOver is told. react-native-web's AccessibilityInfo
// has no announceForAccessibilityWithOptions (a browser has no screen reader
// API to call), so the native one is stood in for by a spy.
const a11y = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  return {
    ...rn,
    AccessibilityInfo: {
      ...rn.AccessibilityInfo,
      announceForAccessibilityWithOptions: a11y.announce,
    },
    Platform: {
      ...rn.Platform,
      get OS() {
        return social.os;
      },
    },
  };
});

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

// #312 — the consent line's two links. The legal URLs exactly as /v1/config
// sends them (already the embed variant, #310); the in-app browser is a spy,
// so a test reads the URL a tap would open.
vi.mock("@/api/config-context", () => ({
  useConfig: () => ({
    urls: {
      web: "https://matio.tv",
      terms: "https://matio.tv/terms?embed=app",
      privacy: "https://matio.tv/privacy?embed=app",
      cookies: "https://matio.tv/cookies?embed=app",
      support: "mailto:contact@matio.tv",
    },
    socialSignIn: social.lever,
  }),
}));
const browser = vi.hoisted(() => ({ open: vi.fn(async () => undefined) }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: browser.open }));

// What a build carries when the owner has set both Google client ids (EAS env
// → app.config.ts → `extra`). Fake-looking on purpose.
const GOOGLE_IDS = {
  EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: "dummy-web.apps.googleusercontent.com",
  EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: "dummy-ios.apps.googleusercontent.com",
};

function resetSocial() {
  social.os = "web";
  social.lever = undefined;
  social.extra = {};
  social.appleButtonProps = null;
  social.appleAvailable.mockReset().mockImplementation(async () => true);
  social.appleStart.mockReset().mockImplementation(async () => ({ createdSessionId: null }));
  social.googleStart.mockReset().mockImplementation(async () => ({ createdSessionId: null }));
}

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
    useClerk.mockClear();
    useSignInWithApple.mockClear();
    useSignInWithGoogle.mockClear();
    resetSocial();
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

  it("without a key no Clerk hook runs — Apple's and Google's included — even with the lever on (#277)", async () => {
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", undefined);
    social.os = "ios";
    social.lever = { apple: true, google: true };
    social.extra = GOOGLE_IDS;
    const SignInForm = await loadSignInForm();

    const html = renderToString(<SignInForm {...props} />);

    expect(html).toContain("Sign-in unavailable");
    expect(html).not.toContain("Continue with");
    for (const hook of [useSignIn, useSignUp, useClerk, useSignInWithApple, useSignInWithGoogle]) {
      expect(hook).not.toHaveBeenCalled();
    }
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

// ---------------------------------------------------------------- the flow

type Result = { error: unknown };
const ok = async (): Promise<Result> => ({ error: null });

// A Clerk API failure as the future API resolves it: ClerkAPIResponseError,
// whose own code is the generic one and whose real code sits on errors[0]
// next to Clerk's English text — the text the form must never print.
function apiError(code: string, message: string) {
  return {
    code: "api_response_error",
    message: `Clerk: ${message}`,
    errors: [{ code, message, longMessage: message }],
  };
}
// A ClerkRuntimeError: the code on the error itself, the message a developer
// string.
const NETWORK_ERROR = {
  code: "network_error",
  message: 'Clerk: Network request failed\n\n(code="network_error")',
};

function clerkResources() {
  const signIn = {
    emailCode: {
      sendCode: vi.fn(ok),
      verifyCode: vi.fn(ok),
    },
    finalize: vi.fn(ok),
  };
  const signUp = {
    create: vi.fn(ok),
    verifications: { sendEmailCode: vi.fn(ok), verifyEmailCode: vi.fn(ok) },
    finalize: vi.fn(ok),
  };
  useSignIn.mockImplementation(() => ({ signIn }));
  useSignUp.mockImplementation(() => ({ signUp }));
  return { signIn, signUp };
}

let container: HTMLDivElement;
let root: Root | null = null;

const text = () => container.textContent ?? "";

function typeInto(value: string) {
  const input = container.querySelector("input");
  if (!input) throw new Error("no input");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Presses a react-native-web Pressable by its visible text: the click bubbles
// from the Text up to the Pressable, where RNW's responder fires onPress.
// Then lets the awaited Clerk calls settle.
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

async function renderForm(
  locale: "en" | "es" = "en",
  onDone = vi.fn(),
  extra: { signInHint?: boolean } = {},
) {
  vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_dummy");
  const SignInForm = await loadSignInForm();
  const { LocaleProvider } = await import("@/i18n/locale");
  root = createRoot(container);
  act(() =>
    root?.render(
      <LocaleProvider initial={locale}>
        <SignInForm {...props} {...extra} onDone={onDone} />
      </LocaleProvider>,
    ),
  );
  return onDone;
}

describe("SignInForm — the email-code flow (#288)", { timeout: COLD_IMPORT_TIMEOUT_MS }, () => {
  beforeEach(() => {
    vi.stubGlobal("__DEV__", false);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useSignIn.mockReset();
    useSignUp.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("an existing member gets the code step by sign-in, with no account created", async () => {
    const { signIn, signUp } = clerkResources();
    await renderForm();

    typeInto("member@example.com");
    await press(props.cta);

    expect(signIn.emailCode.sendCode).toHaveBeenCalledWith({ emailAddress: "member@example.com" });
    expect(signUp.create).not.toHaveBeenCalled();
    expect(text()).toContain("Check your email");
  });

  it("only an unknown address falls through to creating the account", async () => {
    const { signIn, signUp } = clerkResources();
    signIn.emailCode.sendCode.mockResolvedValueOnce({
      error: apiError("form_identifier_not_found", "Couldn't find your account."),
    });
    await renderForm();

    typeInto("new@example.com");
    await press(props.cta);

    // With the app's language (#304 item 3).
    expect(signUp.create).toHaveBeenCalledWith({ emailAddress: "new@example.com", locale: "en" });
    expect(signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Check your email");
  });

  it("a Spanish viewer's account is created with the Spanish locale (#304 item 3)", async () => {
    const { signIn, signUp } = clerkResources();
    signIn.emailCode.sendCode.mockResolvedValueOnce({
      error: apiError("form_identifier_not_found", "Couldn't find your account."),
    });
    await renderForm("es");

    typeInto("nueva@example.com");
    await press(props.cta);

    expect(signUp.create).toHaveBeenCalledWith({ emailAddress: "nueva@example.com", locale: "es" });
  });

  it("a rate limit on sign-in is shown as itself — never a sign-up that says the address is taken", async () => {
    const { signIn, signUp } = clerkResources();
    signIn.emailCode.sendCode.mockResolvedValueOnce({
      error: apiError("too_many_requests", "Too many requests. Please try again in a bit."),
    });
    // What the old fall-through would have met on an existing address.
    signUp.create.mockResolvedValue({
      error: apiError("form_identifier_exists", "That email address is taken. Please try another."),
    });
    await renderForm();

    typeInto("member@example.com");
    await press(props.cta);

    expect(signUp.create).not.toHaveBeenCalled();
    expect(text()).toContain("Too many requests. Please try again in a moment.");
    expect(text()).not.toContain("taken");
    // Still on the email step, ready for another go.
    expect(text()).toContain(props.cta);
  });

  it("a dead network reads as the connection hint, never Clerk's developer string", async () => {
    const { signIn, signUp } = clerkResources();
    signIn.emailCode.sendCode.mockResolvedValueOnce({ error: NETWORK_ERROR });
    await renderForm();

    typeInto("member@example.com");
    await press(props.cta);

    expect(signUp.create).not.toHaveBeenCalled();
    expect(text()).toContain("Check your connection and try again.");
    expect(text()).not.toContain("Clerk:");
    expect(text()).not.toContain("network_error");
  });

  it("a Clerk call that throws still ends in a message, and the form is usable again", async () => {
    const { signIn } = clerkResources();
    signIn.emailCode.sendCode.mockRejectedValueOnce(new Error("undefined is not a function"));
    await renderForm();

    typeInto("member@example.com");
    await press(props.cta);

    expect(text()).toContain("Something went wrong. Please try again.");
    expect(text()).not.toContain("undefined is not a function");
    // Not stuck on «Please wait…»: the button is back and works.
    expect(text()).toContain(props.cta);
    await press(props.cta);
    expect(signIn.emailCode.sendCode).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Check your email");
  });

  it("maps every code the verify step can meet, and an unknown one to the generic line", async () => {
    const { signIn } = clerkResources();
    await renderForm();
    typeInto("member@example.com");
    await press(props.cta);

    const cases: Array<[unknown, string]> = [
      [apiError("form_code_incorrect", "is incorrect"), "Incorrect code."],
      [apiError("verification_expired", "This verification has expired."), "This code has expired. Request a new one."],
      [apiError("verification_failed", "Too many failed attempts."), "Too many failed attempts. Request a new code."],
      [apiError("form_param_format_invalid", "must be a number"), "Enter the code from your email."],
      [apiError("some_future_code", "A brand-new Clerk sentence"), "Something went wrong. Please try again."],
    ];
    for (const [error, shown] of cases) {
      signIn.emailCode.verifyCode.mockResolvedValueOnce({ error });
      typeInto("123456");
      await press("Sign in");
      expect(text()).toContain(shown);
      expect(text()).not.toContain("is incorrect");
      expect(text()).not.toContain("A brand-new Clerk sentence");
    }
  });

  it("a verify call that throws ends in a message instead of silence", async () => {
    const { signIn } = clerkResources();
    const onDone = await renderForm();
    typeInto("member@example.com");
    await press(props.cta);

    signIn.emailCode.verifyCode.mockRejectedValueOnce(new Error("boom"));
    typeInto("123456");
    await press("Sign in");

    expect(text()).toContain("Something went wrong. Please try again.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("verifies, finalizes and reports success once", async () => {
    const { signIn } = clerkResources();
    const onDone = await renderForm();
    typeInto("member@example.com");
    await press(props.cta);

    typeInto("123456");
    await press("Sign in");

    expect(signIn.emailCode.verifyCode).toHaveBeenCalledWith({ code: "123456" });
    expect(signIn.finalize).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("speaks Spanish to a Spanish viewer — Clerk only ever answers in English", async () => {
    const { signIn } = clerkResources();
    signIn.emailCode.sendCode.mockResolvedValueOnce({
      error: apiError("too_many_requests", "Too many requests. Please try again in a bit."),
    });
    await renderForm("es");

    typeInto("socia@example.com");
    await press(props.cta);

    expect(text()).toContain("Demasiados intentos. Inténtalo de nuevo en un momento.");
    expect(text()).not.toContain("Too many requests");
  });
});

// ------------------------------------------------------- #292 visible polish

function flowSuite(name: string, body: () => void) {
  describe(name, { timeout: COLD_IMPORT_TIMEOUT_MS }, () => {
    beforeEach(() => {
      vi.stubGlobal("__DEV__", false);
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      useSignIn.mockReset();
      useSignUp.mockReset();
      container = document.createElement("div");
      document.body.appendChild(container);
    });

    afterEach(() => {
      act(() => root?.unmount());
      root = null;
      container.remove();
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    body();
  });
}

flowSuite("SignInForm — «Already have an account? Sign in» (#292 item 7)", () => {
  it("turns the headline and the CTA into a sign-in, and «Create account» turns them back", async () => {
    clerkResources();
    await renderForm("en", vi.fn(), { signInHint: true });
    expect(text()).toContain(props.headline);
    expect(text()).toContain(props.cta);

    await press("Sign in");

    expect(text()).not.toContain(props.headline);
    expect(text()).not.toContain(props.cta);
    expect(text()).toContain("Send code");
    expect(text()).toContain("We'll email you a code. No password needed.");
    expect(text()).not.toContain("Already have an account?");
    expect(text()).toContain("No account yet?");
    // The field is where the viewer is sent, as before.
    expect(document.activeElement).toBe(container.querySelector("input"));

    await press("Create account");

    expect(text()).toContain(props.headline);
    expect(text()).toContain(props.cta);
    expect(text()).toContain("Already have an account?");
  });

  it("the flow behind the sign-in wording is the same one", async () => {
    const { signIn, signUp } = clerkResources();
    await renderForm("en", vi.fn(), { signInHint: true });

    await press("Sign in");
    typeInto("member@example.com");
    await press("Send code");

    expect(signIn.emailCode.sendCode).toHaveBeenCalledWith({ emailAddress: "member@example.com" });
    expect(signUp.create).not.toHaveBeenCalled();
    expect(text()).toContain("Check your email");
  });

  it("reads Spanish to a Spanish viewer", async () => {
    clerkResources();
    await renderForm("es", vi.fn(), { signInHint: true });

    await press("Inicia sesión");

    expect(text()).toContain("Enviar código");
    expect(text()).toContain("¿No tienes cuenta?");
    expect(text()).toContain("Crear cuenta");
  });
});

flowSuite("SignInForm — the code step (#292 item 4)", () => {
  // Seconds of the cooldown, with React's effects flushed in between — each
  // tick schedules the next.
  async function tick(seconds: number) {
    for (let i = 0; i < seconds; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }
  }

  const codeInput = () => container.querySelector("input");

  it("focuses the code field the moment the step opens", async () => {
    clerkResources();
    await renderForm();
    typeInto("member@example.com");
    await press(props.cta);

    expect(text()).toContain("Check your email");
    expect(codeInput()).not.toBeNull();
    expect(document.activeElement).toBe(codeInput());
  });

  it("«Resend code» waits 30 s, then sends a fresh code on the same sign-in and waits again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { signIn, signUp } = clerkResources();
    await renderForm();
    typeInto("member@example.com");
    await press(props.cta);

    expect(text()).toContain("Resend code in 30s");
    await press("Resend code in 30s");
    expect(signIn.emailCode.sendCode).toHaveBeenCalledTimes(1);

    await tick(29);
    expect(text()).toContain("Resend code in 1s");
    await tick(1);
    expect(text()).not.toContain("Resend code in");

    await press("Resend code");
    expect(signIn.emailCode.sendCode).toHaveBeenCalledTimes(2);
    // The sign-in already exists: a resend carries no address.
    expect(signIn.emailCode.sendCode).toHaveBeenLastCalledWith();
    expect(signUp.verifications.sendEmailCode).not.toHaveBeenCalled();
    expect(text()).toContain("Resend code in 30s");
  });

  // #304 item 2 — iOS stops JS timers while the app is in the background,
  // which is exactly where the viewer goes to fetch the code (Mail). The
  // clock moves on regardless; vi.setSystemTime is that: time passes, no
  // timer fires.
  it("back from Mail 45 s later, «Resend code» is ready on the first tick — the countdown reads the clock", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { signIn } = clerkResources();
    await renderForm();
    typeInto("member@example.com");
    await press(props.cta);
    await tick(4);
    expect(text()).toContain("Resend code in 26s");

    vi.setSystemTime(Date.now() + 45_000);
    await tick(1);

    expect(text()).not.toContain("Resend code in");
    await press("Resend code");
    expect(signIn.emailCode.sendCode).toHaveBeenCalledTimes(2);
  });

  it("a tap that beats the first tick back is judged by the clock, not by the stale label", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { signIn } = clerkResources();
    await renderForm();
    typeInto("member@example.com");
    await press(props.cta);
    await tick(4);

    vi.setSystemTime(Date.now() + 45_000);
    await press("Resend code in 26s");

    expect(signIn.emailCode.sendCode).toHaveBeenCalledTimes(2);
  });

  it("a new account's code is resent through the sign-up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { signIn, signUp } = clerkResources();
    signIn.emailCode.sendCode.mockResolvedValueOnce({
      error: apiError("form_identifier_not_found", "Couldn't find your account."),
    });
    await renderForm();
    typeInto("new@example.com");
    await press(props.cta);
    expect(signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1);

    await tick(30);
    await press("Resend code");

    expect(signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(2);
    expect(signIn.emailCode.sendCode).toHaveBeenCalledTimes(1);
  });

  it("a refused resend is told in the viewer's words, and can be tried again at once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { signIn } = clerkResources();
    await renderForm();
    typeInto("member@example.com");
    await press(props.cta);
    await tick(30);

    signIn.emailCode.sendCode.mockResolvedValueOnce({
      error: apiError("too_many_requests", "Too many requests. Please try again in a bit."),
    });
    await press("Resend code");

    expect(text()).toContain("Too many requests. Please try again in a moment.");
    expect(text()).toContain("Resend code");
    expect(text()).not.toContain("Resend code in");
  });

  it("«Use a different email» leaves the old code and error behind", async () => {
    const { signIn } = clerkResources();
    await renderForm();
    typeInto("member@example.com");
    await press(props.cta);

    signIn.emailCode.verifyCode.mockResolvedValueOnce({
      error: apiError("form_code_incorrect", "is incorrect"),
    });
    typeInto("111111");
    await press("Sign in");
    expect(text()).toContain("Incorrect code.");

    await press("Use a different email");

    expect(text()).not.toContain("Incorrect code.");
    expect(text()).toContain(props.headline);
    typeInto("other@example.com");
    await press(props.cta);
    expect(text()).toContain("We sent a code to other@example.com.");
    expect(codeInput()?.value).toBe("");
    expect(text()).not.toContain("Incorrect code.");
  });

  it("each field has a spoken name — the code field is no longer «000000» (#304 item 1)", async () => {
    clerkResources();
    await renderForm();
    expect(codeInput()?.getAttribute("aria-label")).toBe("Email address");

    typeInto("member@example.com");
    await press(props.cta);

    expect(codeInput()?.getAttribute("aria-label")).toBe("Verification code");
    expect(codeInput()?.getAttribute("placeholder")).toBe("000000");
  });

  it("names the fields in Spanish for a Spanish viewer (#304 item 1)", async () => {
    clerkResources();
    await renderForm("es");
    expect(codeInput()?.getAttribute("aria-label")).toBe("Correo electrónico");

    typeInto("socia@example.com");
    await press(props.cta);

    expect(codeInput()?.getAttribute("aria-label")).toBe("Código de verificación");
  });

  it("a failure is announced, queued, and drawn as a polite alert (#304 item 1)", async () => {
    a11y.announce.mockClear();
    const { signIn } = clerkResources();
    await renderForm();
    typeInto("member@example.com");
    await press(props.cta);
    expect(a11y.announce).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    signIn.emailCode.verifyCode.mockResolvedValueOnce({
      error: apiError("form_code_incorrect", "is incorrect"),
    });
    typeInto("111111");
    await press("Sign in");

    expect(a11y.announce).toHaveBeenCalledTimes(1);
    expect(a11y.announce).toHaveBeenCalledWith("Incorrect code.", { queue: true });
    const line = container.querySelector('[role="alert"]');
    expect(line?.textContent).toBe("Incorrect code.");
    expect(line?.getAttribute("aria-live")).toBe("polite");

    // A second wrong code is a second failure — said again, not swallowed
    // because the words are the same.
    signIn.emailCode.verifyCode.mockResolvedValueOnce({
      error: apiError("form_code_incorrect", "is incorrect"),
    });
    typeInto("222222");
    await press("Sign in");

    expect(a11y.announce).toHaveBeenCalledTimes(2);
  });

  it("the same bad input twice is said twice — an address with no «@», then a short code (#304 item 1)", async () => {
    a11y.announce.mockClear();
    clerkResources();
    await renderForm();

    typeInto("not-an-address");
    await press(props.cta);
    await press(props.cta);
    expect(a11y.announce).toHaveBeenCalledTimes(2);
    expect(a11y.announce).toHaveBeenNthCalledWith(2, "Enter a valid email address.", { queue: true });

    typeInto("member@example.com");
    await press(props.cta);
    typeInto("12");
    await press("Sign in");
    await press("Sign in");
    expect(a11y.announce).toHaveBeenCalledTimes(4);
    expect(a11y.announce).toHaveBeenLastCalledWith("Enter the code from your email.", { queue: true });
  });

  it("none of the form's gold buttons carries the ▶ play glyph", async () => {
    clerkResources();
    await renderForm();
    const glyphs = () => container.querySelectorAll('[data-testid="play-glyph"]').length;

    expect(glyphs()).toBe(0);
    typeInto("member@example.com");
    await press(props.cta);
    expect(text()).toContain("Check your email");
    expect(glyphs()).toBe(0);
  });
});

// ------------------------------------------------ #312 the consent line

flowSuite("SignInForm — the Terms / Privacy line under the email CTA (#312)", () => {
  // The element whose own text is exactly `label` — a nested Text link is a
  // leaf span inside the line.
  function leaf(label: string): Element | undefined {
    return Array.from(container.querySelectorAll("*")).find(
      (el) => el.children.length === 0 && el.textContent === label,
    );
  }

  beforeEach(() => browser.open.mockClear());

  it("the email step says what the address is taken under, both documents as links", async () => {
    clerkResources();
    await renderForm();

    expect(text()).toContain(
      "By continuing you agree to the Terms and acknowledge the Privacy Policy",
    );
    expect(leaf("Terms")?.getAttribute("role")).toBe("link");
    expect(leaf("Privacy Policy")?.getAttribute("role")).toBe("link");

    // Legal copy the viewer must be able to read: the line and both links
    // clear AA on the screen's espresso (nothing in the form paints behind).
    const link = leaf("Terms") as Element;
    const line = link.parentElement as Element;
    expect(paintedBackground(line)).toBeNull();
    expect(contrastRatio(getComputedStyle(line).color, colors.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(getComputedStyle(link).color, colors.bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("each link opens its document's embed page in English", async () => {
    clerkResources();
    await renderForm("en");

    await press("Terms");
    expect(browser.open).toHaveBeenLastCalledWith("https://matio.tv/terms?embed=app");

    await press("Privacy Policy");
    expect(browser.open).toHaveBeenLastCalledWith("https://matio.tv/privacy?embed=app");
    expect(browser.open).toHaveBeenCalledTimes(2);
  });

  it("a Spanish viewer reads the line in Spanish and gets the /es documents", async () => {
    clerkResources();
    await renderForm("es");

    expect(text()).toContain(
      "Al continuar, aceptas los Términos y reconoces haber leído la Política de privacidad",
    );
    expect(leaf("Términos")?.getAttribute("role")).toBe("link");
    expect(leaf("Política de privacidad")?.getAttribute("role")).toBe("link");

    await press("Términos");
    expect(browser.open).toHaveBeenLastCalledWith("https://matio.tv/es/terms?embed=app");

    await press("Política de privacidad");
    expect(browser.open).toHaveBeenLastCalledWith("https://matio.tv/es/privacy?embed=app");
  });

  it("the line goes with the email step — the code step does not repeat it", async () => {
    clerkResources();
    await renderForm();

    typeInto("member@example.com");
    await press(props.cta);

    expect(text()).toContain("Check your email");
    expect(text()).not.toContain("By continuing you agree");
    expect(leaf("Terms")).toBeUndefined();
  });
});

// #314 — the error line was rust: 3.2:1 on the screen's espresso, under AA's
// 4.5 for 13pt text. It is cream now; rust stays as the bar at its start, so
// the line still reads as an error without being the hard-to-read part.
flowSuite("SignInForm — the error line reads at AA contrast (#314)", () => {
  it("is cream straight on the screen's espresso — rust only as the bar before it", async () => {
    clerkResources();
    await renderForm();
    typeInto("not-an-address");
    await press(props.cta);

    const line = container.querySelector('[role="alert"]');
    expect(line?.textContent).toBe("Enter a valid email address.");
    const style = getComputedStyle(line as Element);
    expect(parseColor(style.color)).toEqual(parseColor(colors.ink));
    // Nothing in the form paints behind the line: what shows through is the
    // screen — /sign-in and the Account tab both paint colors.bg.
    expect(paintedBackground(line as Element)).toBeNull();
    expect(contrastRatio(style.color, colors.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    // The non-text cue.
    expect(parseColor(style.borderLeftColor)).toEqual(parseColor(colors.rust));
    expect(style.borderLeftWidth).toBe("2px");
  });
});

// ------------------------------------------- #277 Apple and Google (board B)

flowSuite("SignInForm — Sign in with Apple and Google under the email form (#277)", () => {
  // Clerk as the provider hands it to the social flows: the sign-in and
  // sign-up it held before the tap, and its own setActive.
  const clerk = {
    client: { signIn: { id: "sia_before" }, signUp: { id: "sua_before" } },
    setActive: vi.fn(async (_params: { session: string }) => undefined),
  };

  beforeEach(() => {
    resetSocial();
    clerk.setActive.mockClear();
    useClerk.mockReset().mockImplementation(() => clerk);
    useSignInWithApple
      .mockReset()
      .mockImplementation(() => ({ startAppleAuthenticationFlow: social.appleStart }));
    useSignInWithGoogle
      .mockReset()
      .mockImplementation(() => ({ startGoogleAuthenticationFlow: social.googleStart }));
  });

  afterEach(() => resetSocial());

  // Renders the form and lets the device's «is Sign in with Apple available?»
  // answer land — no button shows before it.
  async function renderSocial(
    lever: { apple: boolean; google: boolean } | undefined,
    { os = "ios", ids = true, locale = "en" as "en" | "es", onDone = vi.fn() } = {},
  ) {
    social.os = os;
    social.lever = lever;
    social.extra = ids ? GOOGLE_IDS : {};
    const resources = clerkResources();
    await renderForm(locale, onDone);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { ...resources, onDone };
  }

  const appleButton = () => container.querySelector('[data-testid="apple-button"]');

  it("lever off: no line, no buttons, Apple is never even asked — the screen as before", async () => {
    for (const lever of [undefined, { apple: false, google: false }]) {
      await renderSocial(lever);

      expect(text()).toContain(props.cta);
      expect(text()).not.toContain("or continue with");
      expect(text()).not.toContain("Continue with Apple");
      expect(text()).not.toContain("Continue with Google");
      act(() => root?.unmount());
      root = null;
    }
    expect(social.appleAvailable).not.toHaveBeenCalled();
    expect(useSignInWithApple).not.toHaveBeenCalled();
    expect(useSignInWithGoogle).not.toHaveBeenCalled();
  });

  it("`apple`: only Apple's own button — Continue, white, 48 pt, radius 12 — under the line", async () => {
    await renderSocial({ apple: true, google: false });

    expect(text()).toContain("or continue with");
    expect(appleButton()).not.toBeNull();
    expect(text()).not.toContain("Continue with Google");
    expect(useSignInWithGoogle).not.toHaveBeenCalled();
    expect(social.appleButtonProps).toMatchObject({
      buttonType: 1, // CONTINUE
      buttonStyle: 0, // WHITE
      cornerRadius: 12,
    });
    expect(StyleSheet.flatten(social.appleButtonProps?.style as StyleProp<ViewStyle>)).toMatchObject({
      height: 48,
      width: "100%",
    });
  });

  it("`apple,google` with the client ids: both, Apple above Google, both below the email field and its CTA", async () => {
    await renderSocial({ apple: true, google: true });

    const page = text();
    expect(page).toContain("Continue with Apple");
    expect(page).toContain("Continue with Google");
    expect(page.indexOf(props.cta)).toBeLessThan(page.indexOf("Continue with Apple"));
    expect(page.indexOf("Continue with Apple")).toBeLessThan(page.indexOf("Continue with Google"));
    const input = container.querySelector("input") as Element;
    expect(
      input.compareDocumentPosition(appleButton() as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Google's button, as its brand guide draws it in the dark theme: the
    // same 48 pt and radius as Apple's.
    const google = Array.from(container.querySelectorAll('[role="button"]')).find(
      (el) => el.textContent === "Continue with Google",
    ) as Element;
    const style = getComputedStyle(google);
    expect(style.height).toBe("48px");
    expect(style.borderTopLeftRadius).toBe("12px");
    expect(parseColor(style.backgroundColor)).toEqual(parseColor(colors.googleSurface));
  });

  it("Google without its client ids in the build: no Google button", async () => {
    await renderSocial({ apple: true, google: true }, { ids: false });

    expect(appleButton()).not.toBeNull();
    expect(text()).not.toContain("Continue with Google");
  });

  it("a device without Sign in with Apple shows neither — never Google alone (App Store 4.8)", async () => {
    social.appleAvailable.mockImplementation(async () => false);
    await renderSocial({ apple: true, google: true });

    expect(social.appleAvailable).toHaveBeenCalledTimes(1);
    expect(appleButton()).toBeNull();
    expect(text()).not.toContain("Continue with Google");
    expect(text()).not.toContain("or continue with");
  });

  it("outside iOS nothing shows, and Apple is not asked", async () => {
    await renderSocial({ apple: true, google: true }, { os: "android" });

    expect(text()).not.toContain("or continue with");
    expect(social.appleAvailable).not.toHaveBeenCalled();
  });

  it("a closed Apple sheet is silent: no error, nothing activated, the form ready again", async () => {
    const { onDone } = await renderSocial({ apple: true, google: false });
    // What the hook resolves with after ERR_REQUEST_CANCELED: no session, and
    // the sign-in / sign-up Clerk already held — here the email form's own
    // half-made sign-up, waiting in missing_requirements for its code.
    social.appleStart.mockResolvedValueOnce({
      createdSessionId: null,
      signIn: clerk.client.signIn,
      signUp: { id: "sua_before", status: "missing_requirements" },
    });

    await press("Continue with Apple");

    expect(social.appleStart).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(clerk.setActive).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(text()).toContain(props.cta);
  });

  it("Apple success: the session goes live, then onDone — once", async () => {
    const { onDone } = await renderSocial({ apple: true, google: false });
    const setActive = vi.fn(async (_params: { session: string }) => undefined);
    social.appleStart.mockResolvedValueOnce({ createdSessionId: "sess_apple", setActive });

    await press("Continue with Apple");

    expect(setActive).toHaveBeenCalledWith({ session: "sess_apple" });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("Google success takes the same path — Clerk's own setActive when the hook hands none", async () => {
    const { onDone } = await renderSocial({ apple: true, google: true });
    social.googleStart.mockResolvedValueOnce({ createdSessionId: "sess_google" });

    await press("Continue with Google");

    expect(social.googleStart).toHaveBeenCalledTimes(1);
    expect(clerk.setActive).toHaveBeenCalledWith({ session: "sess_google" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("an account Apple made without an address says so in our words — never Clerk's", async () => {
    const { onDone } = await renderSocial({ apple: true, google: false });
    social.appleStart.mockResolvedValueOnce({
      createdSessionId: null,
      signUp: { id: "sua_apple", status: "missing_requirements" },
    });

    await press("Continue with Apple");

    const line = container.querySelector('[role="alert"]');
    expect(line?.textContent).toBe(
      "We didn't get your email address. Continue with your email instead.",
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a flow that throws ends in our message — not Clerk's text, not the address it quotes", async () => {
    await renderSocial({ apple: true, google: true });
    social.googleStart.mockRejectedValueOnce(
      apiError("external_account_exists", "person@example.com is already connected to another account."),
    );

    await press("Continue with Google");

    expect(text()).toContain("Couldn't sign you in. Try again or use your email.");
    expect(text()).not.toContain("person@example.com");
    // And the form is not stuck: the CTA is back.
    expect(text()).toContain(props.cta);
  });

  it("a dead network on Apple reads as the connection hint", async () => {
    await renderSocial({ apple: true, google: false });
    social.appleStart.mockRejectedValueOnce(NETWORK_ERROR);

    await press("Continue with Apple");

    expect(text()).toContain("Check your connection and try again.");
    expect(text()).not.toContain("Clerk:");
  });

  it("one flow at a time: while Apple's sheet is up, neither the email CTA nor Google starts", async () => {
    const { signIn } = await renderSocial({ apple: true, google: true });
    let finish: (value: Flow) => void = () => undefined;
    social.appleStart.mockImplementationOnce(
      () => new Promise<Flow>((resolve) => (finish = resolve)),
    );

    await press("Continue with Apple");
    expect(text()).toContain("Please wait…");

    typeInto("member@example.com");
    await press("Please wait…");
    await press("Continue with Google");
    expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
    expect(social.googleStart).not.toHaveBeenCalled();

    await act(async () => {
      finish({ createdSessionId: null });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(text()).toContain(props.cta);
  });

  it("the code step is the email flow alone — no provider buttons", async () => {
    await renderSocial({ apple: true, google: true });
    expect(appleButton()).not.toBeNull();

    typeInto("member@example.com");
    await press(props.cta);

    expect(text()).toContain("Check your email");
    expect(appleButton()).toBeNull();
    expect(text()).not.toContain("Continue with Google");
  });

  it("speaks Spanish to a Spanish viewer: the line, Google's words, and the failures", async () => {
    await renderSocial({ apple: true, google: true }, { locale: "es" });

    expect(text()).toContain("o continúa con");
    expect(text()).toContain("Continuar con Google");

    social.appleStart.mockResolvedValueOnce({
      createdSessionId: null,
      signUp: { id: "sua_apple", status: "missing_requirements" },
    });
    await press("Continue with Apple");
    expect(text()).toContain("No recibimos tu correo. Continúa con tu correo electrónico.");

    social.googleStart.mockRejectedValueOnce(new Error("boom"));
    await press("Continuar con Google");
    expect(text()).toContain("No se pudo iniciar sesión. Inténtalo de nuevo o usa tu correo.");
  });
});
