import { useSignIn, useSignUp } from "@clerk/expo";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CLERK_PUBLISHABLE_KEY } from "@/auth/clerk";
import { ErrorState, GoldButton, Pill } from "@/components/ui";
import { body, colors, display, radius, SCREEN_PAD, space } from "@/theme";

// Passwordless email-code sign-in.
//
// Matio accounts have no password — the web's guest-checkout flow creates them
// with skipPasswordRequirement, so the email code IS the canonical credential.
// That makes one combined screen possible: the user enters an email, and
// whether this is a sign-in or a sign-up is the server's problem, not theirs.
//
// This uses Clerk's "future" resource API (@clerk/expo 4.x), whose methods
// RESOLVE with `{ error }` instead of throwing. Wrapping them in try/catch
// silently succeeds on failure — every call here must check the returned error.

type Step = "email" | "code";
type Flow = "signIn" | "signUp";

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which flow the address resolved to; the code must be verified against the
  // same one that sent it.
  const [flow, setFlow] = useState<Flow>("signIn");

  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <ErrorState
        message="Sign-in unavailable"
        hint="This build has no Clerk publishable key configured."
      />
    );
  }

  async function sendCode() {
    if (busy || !signIn || !signUp) return;
    const address = email.trim();
    if (!address.includes("@")) {
      setError("Enter a valid email address.");
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
      setError("Enter the code from your email.");
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

      // back() rather than replace("/"): the user came here from a locked
      // episode and should land back on it, now unlocked.
      router.back();
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(signIn && signUp);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + space(10), paddingBottom: insets.bottom + space(8) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignSelf: "flex-start" }}>
          <Pill label="Keep watching free" />
        </View>
        <Text style={styles.title}>
          {step === "email" ? "Create your account" : "Check your email"}
        </Text>
        <Text style={styles.copy}>
          {step === "email"
            ? "Create a free account to keep watching and save your progress across every series."
            : `We sent a code to ${email.trim()}.`}
        </Text>

        {step === "email" ? (
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
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

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GoldButton
          label={busy ? "Please wait…" : step === "email" ? "Send code" : "Sign in"}
          onPress={() => {
            if (!ready) return;
            void (step === "email" ? sendCode() : verifyCode());
          }}
          style={{ alignSelf: "stretch", marginTop: space(5) }}
        />

        <Pressable
          onPress={() => (step === "code" ? setStep("email") : router.back())}
          style={{ marginTop: space(5) }}
          hitSlop={8}
        >
          <Text style={styles.secondary}>
            {step === "code" ? "Use a different email" : "Not now"}
          </Text>
        </Pressable>

        <Text style={styles.fine}>No card needed. Just an email.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
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
  return "Something went wrong. Try again.";
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: SCREEN_PAD,
    gap: space(2),
  },
  title: { ...display, color: colors.ink, fontSize: 34, lineHeight: 38, marginTop: space(2) },
  copy: { ...body, color: colors.inkMuted, fontSize: 14, lineHeight: 21 },
  input: {
    ...body,
    marginTop: space(4),
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
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
