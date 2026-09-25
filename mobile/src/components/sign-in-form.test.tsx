/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    expect(signUp.create).toHaveBeenCalledWith({ emailAddress: "new@example.com" });
    expect(signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Check your email");
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
