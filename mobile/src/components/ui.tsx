import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { body, colors, display, radius, SCREEN_PAD, space, toneStopsFor } from "@/theme";

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
export function Artwork({
  uri,
  toneKey,
  style,
}: {
  uri: string | null;
  toneKey: string;
  style?: ViewStyle;
}) {
  const [from, to] = toneStopsFor(toneKey);
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
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      <Duotone />
    </View>
  );
}

// ---------------------------------------------------------------- text bits

export function Pill({ label, tone = "burgundy" }: { label: string; tone?: "burgundy" | "glass" }) {
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: tone === "burgundy" ? colors.burgundy : colors.glass },
      ]}
    >
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

// Meta row separated by rust dots, per the 8a spec.
export function MetaRow({ parts }: { parts: string[] }) {
  const shown = parts.filter(Boolean);
  return (
    <View style={styles.metaRow}>
      {shown.map((part, i) => (
        <View key={part + i} style={styles.metaItem}>
          {i > 0 ? <View style={styles.metaDot} /> : null}
          <Text style={styles.metaText}>{part}</Text>
        </View>
      ))}
    </View>
  );
}

export function GoldButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ borderRadius: radius.pill }, style, pressed && { opacity: 0.85 }]}
    >
      {/* linear-gradient(180deg, gold-hi, gold-lo) — the spec's CTA fill. */}
      <LinearGradient
        colors={[colors.goldHi, colors.goldLo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.goldButton}
      >
        <View style={styles.playGlyph} />
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

// 2:3 poster card used by the catalog rails.
const POSTER_W = 148;

export function PosterCard({
  title,
  posterUrl,
  slug,
  badge,
  onPress,
}: {
  title: string;
  posterUrl: string | null;
  slug: string;
  badge?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width: POSTER_W }, pressed && { opacity: 0.8 }]}>
      <Artwork
        uri={posterUrl}
        toneKey={slug}
        style={{ width: POSTER_W, height: POSTER_W * 1.5, borderRadius: radius.poster }}
      />
      {badge ? (
        <View style={styles.posterBadge}>
          <Pill label={badge} />
        </View>
      ) : null}
      <Text numberOfLines={2} style={styles.posterTitle}>
        {title}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- states

export function Loading() {
  return (
    <View style={styles.centred}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}

export function ErrorState({
  message,
  hint,
  onRetry,
}: {
  message: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.centred}>
      <Text style={styles.errorTitle}>{message}</Text>
      {hint ? <Text style={styles.errorHint}>{hint}</Text> : null}
      {onRetry ? <GoldButton label="Try again" onPress={onRetry} style={{ marginTop: space(6) }} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- helpers

export function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

export function episodeCountLabel(n: number): string {
  return n === 1 ? "1 episode" : `${n} episodes`;
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
  centred: { flex: 1, alignItems: "center", justifyContent: "center", padding: SCREEN_PAD },
  errorTitle: { ...display, color: colors.ink, fontSize: 18, textAlign: "center" },
  errorHint: {
    ...body,
    color: colors.inkDim,
    fontSize: 13,
    textAlign: "center",
    marginTop: space(2),
  },
});
