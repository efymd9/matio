import { Pressable, StyleSheet, Text, View } from "react-native";
import { GoldButton, Pill } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { body, colors, display, SCREEN_PAD, space } from "@/theme";

// The sign-up wall — the app's twin of the web's SignupWall, by intent: a
// locked episode is an ask, not an error. Rendered full-surface wherever a
// gated episode would otherwise play: as the player's answer to a 403
// signup_required, and as the feed's page for an episode the positional
// gate locks (so an auto-advance or a swipe lands on the wall, never on a
// stalled player).
export function SignupWall({ onSignIn, onBack }: { onSignIn: () => void; onBack: () => void }) {
  const t = useT();
  return (
    <View style={styles.wall}>
      <Pill label={t.signupWall.kicker} />
      <Text style={styles.wallTitle}>{t.signupWall.headline}</Text>
      <Text style={styles.wallCopy}>{t.signupWall.bodyNoCount}</Text>
      <GoldButton
        label={t.signupWall.signUpCta}
        onPress={onSignIn}
        style={{ alignSelf: "stretch", marginTop: space(5) }}
      />
      <Pressable onPress={onBack} style={{ marginTop: space(5) }} hitSlop={8}>
        <Text style={styles.wallSecondary}>{t.app.common.notNow}</Text>
      </Pressable>
      <Text style={styles.wallFine}>{t.signupWall.noCardNeeded}</Text>
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
