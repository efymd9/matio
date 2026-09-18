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
// silently succeeds on failure — every call here must check the returned error.

type Step = "email" | "code";
type Flow = "signIn" | "signUp";

export function SignInForm({
  kicker,
  headline,
  bodyText,
  cta,
  onDone,
  onCancel,
  signInHint = false,
}: {
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
}) {
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

  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <ErrorState message={t.app.signIn.unavailable} hint={t.app.signIn.unavailableHint} />
    );
  }

  // Clerk errors carry a user-safe message; anything else gets a generic line
  // rather than leaking an internal string into the UI.
  function messageFor(err: unknown): string {
    if (typeof err === "object" && err !== null) {
      const e = err as { errors?: { message?: string }[]; message?: string };
      const first = e.errors?.[0]?.message;
      if (first) return first;
      if (e.message) return e.message;
    }
    return t.seriesEndOverlay.errorGeneric;
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
        style={{ alignSelf: "stretch", marginTop: space(5) }}
      />

      {secondary ? (
        <Pressable
          onPress={() => (step === "code" ? setStep("email") : onCancel?.())}
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
