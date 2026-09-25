import { useSignIn, useSignUp } from "@clerk/expo";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CLERK_PUBLISHABLE_KEY } from "@/auth/clerk";
import { GlassSurface } from "@/components/glass";
import { ErrorState, GoldButton, Pill } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { body, colors, display, radius, space } from "@/theme";

// Passwordless email-code sign-in — the two-step form itself, shared by the
// modal sign-in screen (app/sign-in.tsx, reached from a locked episode) and
// the Account tab's signed-out state (#245). The screens own the copy of the
// first step and what happens on success; the form owns the Clerk dance.
//
// Matio accounts have no password — the web's guest-checkout flow creates them
// with skipPasswordRequirement, so the email code IS the canonical credential.
// That makes one combined form possible: the user enters an email, and
// whether this is a sign-in or a sign-up is the server's problem, not theirs.
//
// This uses Clerk's "future" resource API (@clerk/expo 4.x), whose methods
// RESOLVE with `{ error }` instead of throwing. Wrapping them in try/catch
// alone silently succeeds on failure — every call here must check the
// returned error; the catch is only for a call that throws anyway.

type Step = "email" | "code";
type Flow = "signIn" | "signUp";

// The only sign-in answer that means "no account with this address": the one
// that sends the form on to create the account. Any other failure — a rate
// limit, a dead network — is shown as itself; falling through on it would
// tell an existing member their own address «is taken».
const UNKNOWN_ADDRESS = "form_identifier_not_found";

// The machine code of a Clerk failure. The future API resolves with either
// a ClerkAPIResponseError — its own `code` is the generic
// "api_response_error", the real one sits on `errors[0]` — or a
// ClerkRuntimeError that carries it directly ("network_error").
function clerkErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { errors?: { code?: unknown }[]; code?: unknown };
  const code = e.errors?.[0]?.code ?? e.code;
  return typeof code === "string" ? code : undefined;
}

type SignInFormProps = {
  // The first step's copy: the modal screen keeps the wall's «Keep watching
  // free» framing, the Account tab greets a viewer who has watched nothing.
  kicker: string;
  headline: string;
  bodyText: string;
  cta: string;
  // After the session is live. The modal screen goes back to the episode it
  // came from; the tab stays put — it re-renders as the signed-in account.
  onDone: () => void;
  // «Not now» on the modal screen; the tab has nowhere to go and passes none.
  onCancel?: () => void;
  // «Already have an account? Sign in» — same field, same flow: the link just
  // focuses the input. Shown on the tab, where the framing is "create".
  signInHint?: boolean;
};

// The gate — and it has to be a SEPARATE component from the form. Without a
// publishable key AuthProvider mounts no ClerkProvider at all (auth/clerk.tsx:
// the deliberate "run signed-out rather than crash" degradation), and every
// provider-bound Clerk hook — useSignIn/useSignUp here, useUser/useClerk on
// the Account tab — THROWS in render outside the provider. An uncaught render
// error is a red box in development and RCTFatal in a release build: the app
// dies. That is exactly how 0.1.0 (4) crashed on the Account tab (#247): the
// build carried no key, and this check used to sit AFTER the hook calls,
// where it could never run. Nothing that calls a Clerk hook may be mounted
// past this line unless the key exists.
export function SignInForm(props: SignInFormProps) {
  const t = useT();
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <ErrorState message={t.app.signIn.unavailable} hint={t.app.signIn.unavailableHint} />
    );
  }
  return <ClerkSignInForm {...props} />;
}

// The form proper. Rendered only behind the gate above, so Clerk's hooks are
// safe here.
function ClerkSignInForm({
  kicker,
  headline,
  bodyText,
  cta,
  onDone,
  onCancel,
  signInHint = false,
}: SignInFormProps) {
  const t = useT();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which flow the address resolved to; the code must be verified against the
  // same one that sent it.
  const [flow, setFlow] = useState<Flow>("signIn");
  const emailInput = useRef<TextInput>(null);

  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  // The failures this form can meet, in the viewer's language. Clerk's own
  // text is English only and its runtime errors are developer strings
  // (`Clerk: Network request failed … (code="network_error")`), so no Clerk
  // message is ever shown: an unmapped code gets the generic line.
  function messageFor(err: unknown): string {
    switch (clerkErrorCode(err)) {
      case "form_code_incorrect":
        return t.app.signIn.codeIncorrect;
      case "verification_expired":
        return t.app.signIn.codeExpired;
      case "verification_failed":
        return t.app.signIn.codeFailed;
      case "too_many_requests":
        return t.app.signIn.tooManyRequests;
      case "network_error":
        return t.app.account.stalledBody;
      case "form_param_format_invalid":
        return step === "email" ? t.app.signIn.invalidEmail : t.app.signIn.invalidCode;
      default:
        return t.seriesEndOverlay.errorGeneric;
    }
  }

  async function sendCode() {
    if (busy || !signIn || !signUp) return;
    const address = email.trim();
    if (!address.includes("@")) {
      setError(t.app.signIn.invalidEmail);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Try sign-in first. An unknown address errors, and that is the signal to
      // create the account instead — Clerk deliberately offers no "does this
      // email exist?" check, since that would be an enumeration oracle.
      const attempt = await signIn.emailCode.sendCode({ emailAddress: address });

      if (!attempt.error) {
        setFlow("signIn");
        setStep("code");
        return;
      }
      if (clerkErrorCode(attempt.error) !== UNKNOWN_ADDRESS) {
        setError(messageFor(attempt.error));
        return;
      }

      const created = await signUp.create({ emailAddress: address });
      if (created.error) {
        setError(messageFor(created.error));
        return;
      }
      const sent = await signUp.verifications.sendEmailCode();
      if (sent.error) {
        setError(messageFor(sent.error));
        return;
      }
      setFlow("signUp");
      setStep("code");
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (busy || !signIn || !signUp) return;
    const value = code.trim();
    if (value.length < 4) {
      setError(t.app.signIn.invalidCode);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const verified =
        flow === "signIn"
          ? await signIn.emailCode.verifyCode({ code: value })
          : await signUp.verifications.verifyEmailCode({ code: value });

      if (verified.error) {
        setError(messageFor(verified.error));
        return;
      }

      // finalize() activates the new session — without it the code is verified
      // but nobody is signed in.
      const finalized = flow === "signIn" ? await signIn.finalize() : await signUp.finalize();
      if (finalized.error) {
        setError(messageFor(finalized.error));
        return;
      }

      onDone();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(signIn && signUp);
  const secondary =
    step === "code" ? t.app.signIn.differentEmail : onCancel ? t.app.common.notNow : null;

  return (
    <View style={styles.form}>
      <View style={{ alignSelf: "flex-start" }}>
        <Pill label={step === "email" ? kicker : t.signupWall.kicker} />
      </View>
      <Text style={styles.title}>{step === "email" ? headline : t.app.signIn.checkEmail}</Text>
      <Text style={styles.copy}>
        {step === "email" ? bodyText : t.app.signIn.codeSent(email.trim())}
      </Text>

      {/* The field is glass, of the same family as the tab bar (board). */}
      <GlassSurface style={styles.field}>
        {step === "email" ? (
          <TextInput
            ref={emailInput}
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder={t.seriesEndOverlay.emailPlaceholder}
            placeholderTextColor={colors.inkDim}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!busy}
            onSubmitEditing={() => void sendCode()}
            returnKeyType="go"
          />
        ) : (
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={setCode}
            placeholder="000000"
            placeholderTextColor={colors.inkDim}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            editable={!busy}
            onSubmitEditing={() => void verifyCode()}
            returnKeyType="go"
          />
        )}
      </GlassSurface>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <GoldButton
        label={busy ? t.app.common.pleaseWait : step === "email" ? cta : t.app.signIn.verify}
        onPress={() => {
          if (!ready) return;
          void (step === "email" ? sendCode() : verifyCode());
        }}
        // Announced as dimmed until Clerk is ready, and busy mid-request.
        disabled={!ready || busy}
        busy={busy}
        style={{ alignSelf: "stretch", marginTop: space(5) }}
      />

      {secondary ? (
        <Pressable
          onPress={() => (step === "code" ? setStep("email") : onCancel?.())}
          accessibilityRole="link"
          style={{ marginTop: space(5) }}
          hitSlop={8}
        >
          <Text style={styles.secondary}>{secondary}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.fine}>{t.signupWall.noCardNeeded}</Text>

      {signInHint && step === "email" ? (
        <Pressable
          onPress={() => emailInput.current?.focus()}
          accessibilityRole="link"
          style={{ marginTop: space(3) }}
          hitSlop={8}
        >
          <Text style={styles.fine}>
            {t.signupWall.alreadyMember}{" "}
            <Text style={{ color: colors.gold }}>{t.signupWall.signInLink}</Text>
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space(2) },
  title: { ...display, color: colors.ink, fontSize: 34, lineHeight: 38, marginTop: space(2) },
  copy: { ...body, color: colors.inkMuted, fontSize: 14, lineHeight: 21 },
  field: {
    marginTop: space(4),
    borderRadius: radius.card,
    overflow: "hidden",
  },
  input: {
    ...body,
    color: colors.ink,
    fontSize: 16,
    paddingHorizontal: space(4),
    paddingVertical: space(4),
  },
  codeInput: { letterSpacing: 6, textAlign: "center", fontFamily: "GeistMono_400Regular" },
  error: { ...body, color: colors.rust, fontSize: 13, marginTop: space(3) },
  secondary: { ...body, color: colors.gold, fontSize: 14, textAlign: "center" },
  fine: {
    ...body,
    color: colors.inkDim,
    fontSize: 12,
    textAlign: "center",
    marginTop: space(6),
  },
});
