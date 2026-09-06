import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocale, useSetLocale, useT } from "@/i18n/locale";
import { SUPPORTED_LOCALES, type Locale } from "@/shared/i18n";
import { colors, display, radius, space } from "@/theme";

// The manual language switcher — the app's twin of the site header's EN | ES
// control, in the same glass pill the home header already wears. The
// current locale is the lit segment; tapping the other one flips the whole
// app optimistically and persists the choice (see i18n/locale.tsx).
export function LocaleSwitch() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useT();

  return (
    <View style={styles.pill} accessibilityRole="radiogroup" accessibilityLabel={t.language.label}>
      {SUPPORTED_LOCALES.map((option: Locale) => {
        const active = option === locale;
        return (
          <Pressable
            key={option}
            onPress={() => setLocale(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.language[option]}
            hitSlop={6}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {option.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    backgroundColor: colors.glass,
    borderRadius: radius.pill,
    padding: 2,
  },
  segment: {
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.25),
    borderRadius: radius.pill,
  },
  segmentActive: { backgroundColor: colors.burgundy },
  label: {
    ...display,
    color: colors.inkDim,
    fontSize: 10,
    letterSpacing: 1,
  },
  labelActive: { color: colors.ink },
});
