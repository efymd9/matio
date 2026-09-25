import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GLASS_INK_INACTIVE, GlassSurface, GoldGlass } from "@/components/glass";
import { Icon, type IconName } from "@/components/icon";
import { colors, fonts, radius } from "@/theme";

// The floating glass tab bar — board B1 «Clear» (#245): a pill inset 18pt from
// the sides and 26pt above the home indicator, four icons, and the active tab
// as a gold glass pill that widens to carry its label. Rendered by expo-router
// through the `tabBar` prop, so it is a JS bar drawn OVER the scene — every
// tab screen pads its content by useTabBarClearance() to scroll out from
// under it; the Liquid Glass refraction over that content is the point.
//
// It lives on the (tabs) group only. The show page and the player are screens
// of the ROOT stack, so neither ever has the bar — by construction, not by a
// per-screen `tabBarStyle: { display: 'none' }`.

export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_BOTTOM = 26;
export const TAB_BAR_INSET = 18;

// How much bottom padding a tab screen's scrolling content needs so its last
// row can clear the bar.
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TAB_BAR_BOTTOM + insets.bottom;
}

// Route name (the file under app/(tabs)/) → icon.
const TAB_ICONS: Record<string, IconName> = {
  index: "home",
  browse: "browse",
  account: "account",
  settings: "settings",
};

export function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <GlassSurface interactive style={[styles.bar, { bottom: TAB_BAR_BOTTOM + insets.bottom }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        // The (tabs) layout sets each screen's `title` from the live
        // dictionary, so a language change re-labels the bar in place.
        const { title } = descriptors[route.key].options;
        const label = title ?? route.name;
        const icon = TAB_ICONS[route.name] ?? "home";

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={[styles.item, focused && styles.itemActive]}
          >
            {focused ? (
              <GoldGlass interactive style={styles.pill}>
                <Icon name={icon} color={colors.goldDeep} />
                {/* Capped for iOS Larger Text: the pill is 64pt tall and
                    shares its row with three icons — unbounded, the label
                    truncates to nothing. */}
                <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {label}
                </Text>
              </GoldGlass>
            ) : (
              <Icon name={icon} color={GLASS_INK_INACTIVE} />
            )}
          </Pressable>
        );
      })}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: TAB_BAR_INSET,
    right: TAB_BAR_INSET,
    height: TAB_BAR_HEIGHT,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 2,
  },
  item: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  // The active tab takes almost twice the room: icon + label; the others
  // are icon-only (B1 — B2 would label all four).
  itemActive: { flex: 1.9 },
  pill: {
    alignSelf: "stretch",
    flex: 1,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 12,
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.goldDeep,
  },
});
