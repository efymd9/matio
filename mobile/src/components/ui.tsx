import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "@/components/icon";
import { useT } from "@/i18n/locale";
import { optimizedImageUrl } from "@/shared/image-url";
import { body, colors, display, fonts, radius, SCREEN_PAD, space, toneStopsFor } from "@/theme";

// ---------------------------------------------------------------- scrim

// Vertical scrim behind hero text. The stop positions are eased rather than
// linear so the dense end sits under the copy and the fade starts gently —
// a straight two-stop ramp puts a visible edge across the middle of the art.
export function Scrim({
  height,
  from = "bottom",
  maxOpacity = 0.95,
}: {
  height: number;
  from?: "top" | "bottom";
  maxOpacity?: number;
}) {
  const stops: [string, string, string, string] = [
    withAlpha(colors.bg, 0),
    withAlpha(colors.bg, maxOpacity * 0.15),
    withAlpha(colors.bg, maxOpacity * 0.6),
    withAlpha(colors.bg, maxOpacity),
  ];
  return (
    <LinearGradient
      pointerEvents="none"
      colors={from === "bottom" ? stops : ([...stops].reverse() as typeof stops)}
      locations={[0, 0.45, 0.75, 1]}
      style={[styles.scrim, { height }, from === "bottom" ? { bottom: 0 } : { top: 0 }]}
    />
  );
}

// ---------------------------------------------------------------- duotone

// The signature gold→burgundy wash over every still, at the 160° angle and the
// 0.2/0.3 opacities of the 8a spec. RN has no `mix-blend-mode: overlay`, so
// this is a straight alpha composite — close at these opacities, and the one
// place to revisit if it ever needs to be exact.
export function Duotone({ strength = 1 }: { strength?: number }) {
  return (
    <LinearGradient
      pointerEvents="none"
      // 160° in CSS ≈ this start/end pair in RN's unit-square coordinates.
      start={{ x: 0.17, y: 0 }}
      end={{ x: 0.83, y: 1 }}
      colors={[
        withAlpha(colors.gold, 0.2 * strength),
        withAlpha(colors.burgundy, 0.3 * strength),
      ]}
      style={StyleSheet.absoluteFill}
    />
  );
}

// #rrggbb → rgba(). Needed because the gradient stops require per-stop alpha
// and the palette is stored as opaque hex.
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------- artwork

// Show/episode artwork with the deterministic tone fallback. `toneKey` is the
// show slug so a missing poster looks the same here as on the web.
//
// `displayWidth` (points) is the width the art is drawn at: given it, show
// artwork comes resized through the site's image optimizer at that width ×
// the screen's pixel ratio — a WebP of a few dozen KB instead of the 2–15 MB
// original (#292). A source the optimizer does not take (a signed Mux
// thumbnail) is fetched as it is.
export function Artwork({
  uri,
  toneKey,
  style,
  displayWidth,
}: {
  uri: string | null;
  toneKey: string;
  style?: ViewStyle;
  displayWidth?: number;
}) {
  const [from, to] = toneStopsFor(toneKey);
  const source =
    displayWidth !== undefined ? optimizedImageUrl(uri, displayWidth * PixelRatio.get()) : uri;
  return (
    <View style={[{ overflow: "hidden" }, style]}>
      {/* Tone gradient sits underneath so it shows through as the fallback
          whenever artwork is missing or still decoding. */}
      <LinearGradient
        colors={[from, to]}
        start={{ x: 0.17, y: 0 }}
        end={{ x: 0.83, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {source ? (
        <Image source={{ uri: source }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      <Duotone />
    </View>
  );
}

// ---------------------------------------------------------------- text bits

// Three tones: the burgundy badge (Matio Original), translucent glass (a
// poster's «Vertical» tag), and the gold membership pill on the Account tab
// — the same goldHi→goldLo fill as the CTA.
// `maxFontSizeMultiplier` caps iOS Larger Text for a pill or meta row that
// sits inside fixed-size chrome (the Home hero card), where unbounded
// scaling clips it; elsewhere they scale freely.
export function Pill({
  label,
  tone = "burgundy",
  maxFontSizeMultiplier,
}: {
  label: string;
  tone?: "burgundy" | "glass" | "gold";
  maxFontSizeMultiplier?: number;
}) {
  if (tone === "gold") {
    return (
      <LinearGradient
        colors={[colors.goldHi, colors.goldLo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.pill}
      >
        <Text
          style={[styles.pillText, { color: colors.goldDeep }]}
          maxFontSizeMultiplier={maxFontSizeMultiplier}
        >
          {label}
        </Text>
      </LinearGradient>
    );
  }
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: tone === "burgundy" ? colors.burgundy : colors.glass },
      ]}
    >
      <Text style={styles.pillText} maxFontSizeMultiplier={maxFontSizeMultiplier}>
        {label}
      </Text>
    </View>
  );
}

// Meta row separated by rust dots, per the 8a spec.
export function MetaRow({
  parts,
  maxFontSizeMultiplier,
}: {
  parts: string[];
  maxFontSizeMultiplier?: number;
}) {
  const shown = parts.filter(Boolean);
  return (
    <View style={styles.metaRow}>
      {shown.map((part, i) => (
        <View key={part + i} style={styles.metaItem}>
          {i > 0 ? <View style={styles.metaDot} /> : null}
          <Text style={styles.metaText} maxFontSizeMultiplier={maxFontSizeMultiplier}>
            {part}
          </Text>
        </View>
      ))}
    </View>
  );
}

// `disabled` and `busy` are ANNOUNCED, not enforced: the caller's handler
// guards the tap (a disabled Pressable stops being the responder — see the
// Play disc in home-feed.tsx), and VoiceOver hears «dimmed» / «busy».
// The ▶ is for buttons that start playback only (`glyph="play"`); Send code,
// Sign in, Try again and the rest carry none (#292).
export function GoldButton({
  label,
  onPress,
  style,
  disabled = false,
  busy = false,
  glyph = "none",
}: {
  label: string;
  onPress?: () => void;
  style?: ViewStyle;
  disabled?: boolean;
  busy?: boolean;
  glyph?: "play" | "none";
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      aria-disabled={disabled}
      aria-busy={busy}
      style={({ pressed }) => [{ borderRadius: radius.pill }, style, pressed && { opacity: 0.85 }]}
    >
      {/* linear-gradient(180deg, gold-hi, gold-lo) — the spec's CTA fill. */}
      <LinearGradient
        colors={[colors.goldHi, colors.goldLo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.goldButton}
      >
        {glyph === "play" ? <View testID="play-glyph" style={styles.playGlyph} /> : null}
        <Text style={styles.goldButtonText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTick} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- rails

export function Rail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: space(9) }}>
      <SectionHeader label={label} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SCREEN_PAD, gap: space(3) }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// 2:3 poster card used by the catalog rails (148 wide) and, sized by the
// caller, by the Browse grid.
const POSTER_W = 148;

export function PosterCard({
  title,
  posterUrl,
  slug,
  badge,
  badgeTone = "burgundy",
  width = POSTER_W,
  onPress,
}: {
  title: string;
  posterUrl: string | null;
  slug: string;
  badge?: string;
  badgeTone?: "burgundy" | "glass";
  width?: number;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.8 }]}
    >
      <Artwork
        uri={posterUrl}
        toneKey={slug}
        style={{ width, height: width * 1.5, borderRadius: radius.poster }}
        displayWidth={width}
      />
      {badge ? (
        <View style={styles.posterBadge}>
          <Pill label={badge} tone={badgeTone} />
        </View>
      ) : null}
      <Text numberOfLines={2} style={styles.posterTitle}>
        {title}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- cards

// The settings-style card group of the Account and Settings tabs (#245):
// an Anton kicker over an espresso card of rows separated by hairlines.
export function GroupLabel({ label }: { label: string }) {
  return <Text style={styles.groupLabel}>{label}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

// One row: a leading icon (or an equal-width spacer so a group with an icon
// on its first row keeps its labels aligned, or any element — the Account
// tab's episode thumb), a label with an optional second line, an optional
// value on the right, and a trailing control.
export function Row({
  icon,
  iconSpacer = false,
  leading,
  label,
  titleCase = false,
  sub,
  value,
  mono = false,
  trailing,
  onPress,
  danger = false,
  first = false,
  role = "button",
  selected,
}: {
  icon?: IconName;
  iconSpacer?: boolean;
  leading?: ReactNode;
  label: string;
  // Anton, one line — a show title rather than a setting's name.
  titleCase?: boolean;
  sub?: string;
  value?: string;
  mono?: boolean;
  trailing?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  first?: boolean;
  role?: AccessibilityRole;
  selected?: boolean;
}) {
  const content = (
    <>
      {leading}
      {icon ? <Icon name={icon} size={22} color={colors.gold} /> : null}
      {!icon && iconSpacer ? <View style={{ width: 22 }} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[
            styles.rowLabel,
            titleCase && styles.rowTitle,
            danger && { color: colors.rust, fontFamily: fonts.bodySemi },
          ]}
          numberOfLines={titleCase ? 1 : undefined}
        >
          {label}
        </Text>
        {sub ? (
          <Text style={styles.rowSub} numberOfLines={titleCase ? 1 : undefined}>
            {sub}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, mono && { fontFamily: fonts.mono }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
    </>
  );
  const rowStyle = [styles.row, !first && styles.rowDivider];
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  // A radio row announces its CHECKED state; «selected» is the vocabulary of
  // tabs and chips, and made the language rows read wrong.
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      aria-checked={role === "radio" ? selected : undefined}
      aria-selected={role === "radio" ? undefined : selected}
      style={({ pressed }) => [rowStyle, pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  );
}

export function Radio({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.radio, selected && styles.radioOn]}>
      {selected ? <View style={styles.radioDot} /> : null}
    </View>
  );
}

// A row's trailing glyph: «›» for a push, «↗» for a link that leaves the app.
export function Chevron({ external = false }: { external?: boolean }) {
  return <Text style={[styles.chevron, external && styles.chevronExternal]}>{external ? "↗" : "›"}</Text>;
}

// ---------------------------------------------------------------- states

export function Loading() {
  return (
    <View style={styles.centred}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}

// `onBack` adds a «Back» text action under the state (under «Try again» when
// there is one) — for a state that is a screen of its own with no other way
// out: an error on a pushed screen (the show page, the player, a feed page —
// no «‹» mounted over an error), where the iOS edge swipe is the only other
// exit and testers do not find it (#292).
export function ErrorState({
  message,
  hint,
  onRetry,
  onBack,
}: {
  message: string;
  hint?: string;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  const t = useT();
  return (
    <View style={styles.centred}>
      <Text style={styles.errorTitle}>{message}</Text>
      {hint ? <Text style={styles.errorHint}>{hint}</Text> : null}
      {onRetry ? (
        <GoldButton label={t.watchError.tryAgain} onPress={onRetry} style={{ marginTop: space(6) }} />
      ) : null}
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="link"
          hitSlop={8}
          style={{ marginTop: space(onRetry ? 5 : 6) }}
        >
          <Text style={styles.errorBack}>{t.app.common.back}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- helpers

// Whole minutes for a duration read-out, never "0 min" for a short clip.
export function durationMinutes(seconds: number | null): number | null {
  if (!seconds) return null;
  return Math.max(1, Math.round(seconds / 60));
}

const styles = StyleSheet.create({
  scrim: { position: "absolute", left: 0, right: 0 },
  pill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
  },
  pillText: {
    ...display,
    color: colors.ink,
    fontSize: 10,
    letterSpacing: 1,
  },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  metaItem: { flexDirection: "row", alignItems: "center" },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.rust,
    marginHorizontal: space(2),
  },
  metaText: { ...body, color: colors.inkDim, fontSize: 12 },
  goldButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
    backgroundColor: colors.goldLo,
    borderRadius: radius.pill,
    paddingVertical: space(4),
    paddingHorizontal: space(6),
  },
  goldButtonText: {
    ...display,
    color: colors.goldDeep,
    fontSize: 14,
    letterSpacing: 1,
  },
  // Triangle via borders — avoids pulling in an icon dependency for one glyph.
  playGlyph: {
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: colors.goldDeep,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: SCREEN_PAD,
    marginBottom: space(4),
  },
  sectionTick: { width: 2, height: 14, backgroundColor: colors.rust },
  sectionLabel: {
    ...display,
    color: colors.gold,
    fontSize: 16,
    letterSpacing: 1.9,
  },
  posterBadge: { position: "absolute", top: space(2), left: space(2) },
  posterTitle: {
    ...display,
    color: colors.ink,
    fontSize: 12,
    marginTop: space(2),
    letterSpacing: 0.3,
  },
  groupLabel: {
    ...display,
    color: colors.gold,
    fontSize: 11,
    letterSpacing: 1.6,
    marginHorizontal: space(1),
    marginBottom: space(2),
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    minHeight: 52,
    paddingVertical: space(2.25),
    paddingHorizontal: space(4),
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  rowLabel: { ...body, color: colors.ink, fontSize: 15 },
  rowTitle: { ...display, fontSize: 13, letterSpacing: 0.3 },
  rowSub: { ...body, color: colors.inkDim, fontSize: 12, marginTop: 1 },
  rowValue: { ...body, color: colors.inkDim, fontSize: 14, flexShrink: 1 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.inkFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: colors.gold },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.gold },
  chevron: { color: colors.inkFaint, fontSize: 20, lineHeight: 22 },
  chevronExternal: { fontSize: 14, lineHeight: 18 },
  centred: { flex: 1, alignItems: "center", justifyContent: "center", padding: SCREEN_PAD },
  errorTitle: { ...display, color: colors.ink, fontSize: 18, textAlign: "center" },
  errorHint: {
    ...body,
    color: colors.inkDim,
    fontSize: 13,
    textAlign: "center",
    marginTop: space(2),
  },
  // The app's secondary text action, as «Not now» on the walls.
  errorBack: { ...body, color: colors.gold, fontSize: 14, textAlign: "center" },
});
