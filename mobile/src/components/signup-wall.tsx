import { Pressable, StyleSheet, Text, View } from "react-native";
import { useConfig } from "@/api/config-context";
import { GoldButton, Pill } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { body, colors, display, SCREEN_PAD, space } from "@/theme";

// The sign-up wall — the app's twin of the web's SignupWall, by intent: a
// locked episode is an ask, not an error. Rendered full-surface wherever a
// gated episode would otherwise play: as the player's answer to a 403
// signup_required, and as the feed's page for an episode the positional
// gate locks (so an auto-advance or a swipe lands on the wall, never on a
// stalled player).
//
// `paywallNext` (#462): the episode stays locked once the viewer has an
// account (paid mode, a subscribers-only episode — subscriptionFollowsSignIn).
// Then the wall promises nothing "free" and names no purchase (3.1.1): no
// kicker, no "No card needed", a body that only asks for the account.
export function SignupWall({
  onSignIn,
  onBack,
  paywallNext = false,
}: {
  onSignIn: () => void;
  onBack: () => void;
  paywallNext?: boolean;
}) {
  const t = useT();
  const { flags } = useConfig();
  return (
    <View style={styles.wall}>
      {paywallNext ? null : <Pill label={t.signupWall.kicker} />}
      <Text style={styles.wallTitle}>{t.signupWall.headline}</Text>
      <Text style={styles.wallCopy}>
        {paywallNext ? t.app.signIn.paywallNextBody : t.signupWall.bodyNoCount}
      </Text>
      <GoldButton
        label={paywallNext ? t.app.signIn.createAccount : t.signupWall.signUpCta}
        onPress={onSignIn}
        style={{ alignSelf: "stretch", marginTop: space(5) }}
      />
      <Pressable onPress={onBack} accessibilityRole="link" style={{ marginTop: space(5) }} hitSlop={8}>
        <Text style={styles.wallSecondary}>{t.app.common.notNow}</Text>
      </Pressable>
      {/* Paid mode only, like the sign-in form's: with payments off there is
          no card to not need (#447, from the #446 audit) — and never in
          front of a subscribers-only episode (#462). */}
      {flags.paymentsEnabled && !paywallNext ? (
        <Text style={styles.wallFine}>{t.signupWall.noCardNeeded}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wall: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    paddingHorizontal: SCREEN_PAD,
    gap: space(2),
  },
  wallTitle: { ...display, color: colors.ink, fontSize: 34, lineHeight: 38, marginTop: space(2) },
  wallCopy: { ...body, color: colors.inkMuted, fontSize: 14, lineHeight: 21 },
  wallSecondary: { ...body, color: colors.gold, fontSize: 14, textAlign: "center" },
  wallFine: {
    ...body,
    color: colors.inkDim,
    fontSize: 12,
    textAlign: "center",
    marginTop: space(6),
  },
});
