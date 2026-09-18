import Constants from "expo-constants";
import { openBrowserAsync } from "expo-web-browser";
import type { ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConfig } from "@/api/config-context";
import { APP_BUILD } from "@/build";
import { useTabBarClearance } from "@/components/glass-tab-bar";
import { Card, Chevron, GroupLabel, Radio, Row } from "@/components/ui";
import { useLocale, useSetLocale, useT } from "@/i18n/locale";
import { useAutoplayNext } from "@/prefs/autoplay";
import { body, colors, display, SCREEN_PAD, space } from "@/theme";

// Settings (#245): language (the switcher that used to be a pill in the home
// header), playback, and the About group with the legal links from
// /v1/config. Notifications (#98) and Downloads (`flags.downloadsEnabled`)
// are deliberately NOT drawn — a control without a function behind it is a
// promise the app cannot keep.
export default function SettingsScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const config = useConfig();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [autoplay, setAutoplay] = useAutoplayNext();

  // «0.1.0 (1)»: the store version from app.json and the native build number
  // — which a dev client has no value for, so the app's own APP_BUILD stands
  // in there.
  const version = `${Constants.expoConfig?.version ?? "0.0.0"} (${
    Constants.nativeBuildVersion ?? APP_BUILD
  })`;
  const supportAddress = config.urls.support.replace(/^mailto:/, "");

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: clearance + space(4) }}
    >
      <Text style={[styles.heading, { marginTop: insets.top + space(4) }]}>
        {t.app.tabs.settings}
      </Text>

      <Group label={t.language.label} hint={t.app.settings.langHint}>
        <Row
          first
          icon="language"
          label={t.language.en}
          trailing={<Radio selected={locale === "en"} />}
          onPress={() => setLocale("en")}
          role="radio"
          selected={locale === "en"}
        />
        <Row
          iconSpacer
          label={t.language.es}
          trailing={<Radio selected={locale === "es"} />}
          onPress={() => setLocale("es")}
          role="radio"
          selected={locale === "es"}
        />
      </Group>

      <Group label={t.app.settings.playback}>
        <Row
          first
          icon="playback"
          label={t.app.settings.autoplayNext}
          trailing={
            <Switch
              value={autoplay}
              onValueChange={setAutoplay}
              trackColor={{ false: colors.track, true: colors.gold }}
              thumbColor={colors.ink}
              ios_backgroundColor={colors.track}
              accessibilityLabel={t.app.settings.autoplayNext}
            />
          }
        />
      </Group>

      <Group label={t.footer.about}>
        <Row first label={t.app.settings.version} value={version} mono />
        <Row
          label={t.footer.terms}
          trailing={<Chevron external />}
          onPress={() => void openBrowserAsync(config.urls.terms)}
          role="link"
        />
        <Row
          label={t.footer.privacy}
          trailing={<Chevron external />}
          onPress={() => void openBrowserAsync(config.urls.privacy)}
          role="link"
        />
        <Row
          label={t.footer.cookies}
          trailing={<Chevron external />}
          onPress={() => void openBrowserAsync(config.urls.cookies)}
          role="link"
        />
        <Row
          label={t.footer.contact}
          value={supportAddress}
          onPress={() => void Linking.openURL(config.urls.support)}
          role="link"
        />
      </Group>
    </ScrollView>
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <GroupLabel label={label} />
      <Card>{children}</Card>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: {
    ...display,
    color: colors.ink,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: 0.4,
    paddingHorizontal: SCREEN_PAD,
    marginBottom: space(6),
  },
  group: { paddingHorizontal: SCREEN_PAD, marginBottom: space(4.5) },
  hint: {
    ...body,
    color: colors.inkDim,
    fontSize: 12,
    marginTop: space(1.5),
    marginHorizontal: space(1),
  },
});
