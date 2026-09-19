import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, ErrorState, Row } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { body, colors, space } from "@/theme";

// The honest state for a Clerk that will not load (#253) — the Account tab
// and the locked-episode sign-in screen both show it where they used to hold
// a spinner forever. ErrorState with its own retry button, then the same
// «why an account» card the key-less build shows (#247), so the screen still
// says what the viewer gets once sign-in is back. `onCancel` is the modal
// screen's way out («Not now», back to the episode); the tab has nowhere to
// go and passes none.
export function AuthStalled({ onRetry, onCancel }: { onRetry: () => void; onCancel?: () => void }) {
  const t = useT();
  return (
    <View>
      <ErrorState
        message={t.app.account.stalledTitle}
        hint={t.app.account.stalledBody}
        onRetry={onRetry}
      />
      <View style={{ marginTop: space(8) }}>
        <Card>
          <Row first icon="playback" label={t.app.account.whyKicker} sub={t.app.account.whyBody} />
        </Card>
      </View>
      {onCancel ? (
        <Pressable onPress={onCancel} style={{ marginTop: space(5) }} hitSlop={8}>
          <Text style={styles.cancel}>{t.app.common.notNow}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cancel: { ...body, color: colors.gold, fontSize: 14, textAlign: "center" },
});
