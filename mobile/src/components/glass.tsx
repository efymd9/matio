import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radius } from "@/theme";

// The glass family of the native shell (#245, board B1 «Clear»): the floating
// tab bar, its active gold pill, the Browse search field and the «‹» back
// button all come through the two surfaces below, so the platform branch
// lives in exactly one place.
//
// Liquid Glass (expo-glass-effect's GlassView — blur, refraction, the light
// rim) exists on iOS 26+ only. The answer is a property of the OS, not of a
// render, so it is read once at module load.
export const LIQUID_GLASS = isLiquidGlassAvailable();

// Without Liquid Glass — Android, iOS < 26 — the surfaces are a translucent
// espresso with a light hairline and NO blur: the owner's decision of
// 2026-09-19 («на Андроиде хватит просто без Liquid Glass»), so expo-blur
// was never added. These are the glass palette, the only colour literals
// outside theme.ts, and they are spelled out in the spec (#245 §2).
const FALLBACK_BACKGROUND = "rgba(26,18,12,0.72)";
const FALLBACK_EDGE = "rgba(246,239,228,0.2)";
// Cream at 62% — an inactive tab icon on either surface.
export const GLASS_INK_INACTIVE = "rgba(246,239,228,0.62)";

type SurfaceProps = {
  style?: StyleProp<ViewStyle>;
  // Liquid Glass reacts to touch when told the surface is tappable. Only the
  // bar, its active pill and the back button are — a search field is not.
  interactive?: boolean;
  children?: ReactNode;
};

// The clear surface. `style` carries geometry only — GlassView ignores a
// backgroundColor laid over the effect, and the fallback supplies its own.
export function GlassSurface({ style, interactive = false, children }: SurfaceProps) {
  if (LIQUID_GLASS) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive={interactive} style={style}>
        {children}
      </GlassView>
    );
  }
  return <View style={[style, styles.fallback]}>{children}</View>;
}

// The gold surface — the active tab's pill. Gold-tinted glass where there is
// glass; otherwise the same goldHi→goldLo fill as GoldButton, so the pill and
// the CTAs are one object on every platform.
export function GoldGlass({ style, interactive = false, children }: SurfaceProps) {
  if (LIQUID_GLASS) {
    return (
      <GlassView
        glassEffectStyle="regular"
        tintColor={colors.gold}
        isInteractive={interactive}
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <LinearGradient
      colors={[colors.goldHi, colors.goldLo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}

// The «‹» that is the show page's only chrome over its hero (and the landscape
// player's, over the video): a 40pt glass disc with the same text glyph the
// app has always drawn, so both platforms look alike.
export function GlassBackButton({
  onPress,
  accessibilityLabel,
  style,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [style, pressed && { opacity: 0.7 }]}
    >
      <GlassSurface interactive style={styles.back}>
        <Text style={styles.backGlyph}>‹</Text>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: FALLBACK_BACKGROUND,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: FALLBACK_EDGE,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: {
    color: colors.ink,
    fontSize: 28,
    lineHeight: 30,
    marginTop: -2,
  },
});
