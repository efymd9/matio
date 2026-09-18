import { useClerk, useUser } from "@clerk/expo";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useCallback } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConfig } from "@/api/config-context";
import { useOptionalAuth } from "@/auth/clerk";
import { useTabBarClearance } from "@/components/glass-tab-bar";
import { SignInForm } from "@/components/sign-in-form";
import {
  Artwork,
  Card,
  Chevron,
  durationMinutes,
  Loading,
  Pill,
  Row,
  SectionHeader,
} from "@/components/ui";
import { useT } from "@/i18n/locale";
import type { ContinueWatchingEntry } from "@/shared/api-types";
import { colors, display, fonts, radius, SCREEN_PAD, space } from "@/theme";
import { useContinueWatching } from "@/watch/use-continue-watching";

// Account (#245). Signed in: who you are, your membership, everything you
// are mid-way through, the way out. Signed out: the sign-up wall's copy as a
// calm tab — the same two-step email → code form the locked-episode screen
// uses — and one card on why an account is worth having.

export default function AccountScreen() {
  const { isLoaded, isSignedIn } = useOptionalAuth();
  // Clerk answers a beat after mount; a signed-out frame that flips to
  // signed-in is worse than a spinner.
  if (!isLoaded) return <Loading />;
  return isSignedIn ? <SignedInAccount /> : <AnonymousAccount />;
}

// Rendered only under a live session, so Clerk's hooks are safe here: the
// provider is mounted whenever isSignedIn can be true.
function SignedInAccount() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const config = useConfig();
  const { user } = useUser();
  const { signOut } = useClerk();
  const resume = useContinueWatching(true);

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const initial = email.charAt(0).toUpperCase();

  const openResume = useCallback(
    (item: ContinueWatchingEntry) =>
      router.push({
        pathname: "/watch/[episodeId]",
        params: {
          episodeId: item.episodeId,
          showSlug: item.show.slug,
          resume: String(item.positionSeconds),
        },
      }),
    [router],
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: clearance + space(4) }}
    >
      <Text style={[styles.heading, { marginTop: insets.top + space(4) }]}>
        {t.app.tabs.account}
      </Text>

      <View style={styles.identity}>
        <LinearGradient
          colors={[colors.goldHi, colors.burgundy]}
          start={{ x: 0.17, y: 0 }}
          end={{ x: 0.83, y: 1 }}
          style={styles.avatar}
        >
          <Text style={styles.initial}>{initial}</Text>
        </LinearGradient>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.email} numberOfLines={1}>
            {email}
          </Text>
          {/* Always «Member»: /v1 does not carry subscription state yet, so
              the app cannot honestly say «Subscriber» (registry). */}
          <View style={{ marginTop: space(1.5) }}>
            <Pill label={t.app.account.member} tone="gold" />
          </View>
        </View>
      </View>

      {resume.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader label={t.home.continueWatching} />
          <View style={styles.group}>
            <Card>
              {resume.map((item, i) => (
                <ContinueRow
                  key={item.show.slug}
                  item={item}
                  first={i === 0}
                  onPress={() => openResume(item)}
                />
              ))}
            </Card>
          </View>
        </View>
      ) : null}

      {config.flags.paymentsEnabled ? (
        <View style={styles.group}>
          <Card>
            <Row
              first
              label={t.footer.manage}
              sub={webHost(config.urls.web)}
              trailing={<Chevron external />}
              onPress={() => void openBrowserAsync(config.urls.web)}
            />
          </Card>
        </View>
      ) : null}

      <View style={styles.group}>
        <Card>
          <Row first label={t.app.account.signOut} danger onPress={() => void signOut()} />
        </Card>
      </View>
    </ScrollView>
  );
}

// One continue-watching row: 16:9 thumb with the resume bar, show title,
// «Ep. n · title · m min». `fraction` comes from the server, like the rail.
function ContinueRow({
  item,
  first,
  onPress,
}: {
  item: ContinueWatchingEntry;
  first: boolean;
  onPress: () => void;
}) {
  const t = useT();
  const minutes = durationMinutes(item.durationSeconds);
  const sub = [
    t.home.epShort(item.episodeNumber),
    item.episodeTitle,
    minutes !== null ? t.showDetail.minutes(minutes) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Row
      first={first}
      leading={
        <View>
          <Artwork
            uri={item.show.heroImageUrl ?? item.show.posterImageUrl}
            toneKey={item.show.slug}
            style={styles.thumb}
          />
          <View style={styles.thumbTrack}>
            <View style={[styles.thumbFill, { width: `${item.fraction * 100}%` }]} />
          </View>
        </View>
      }
      titleCase
      label={item.show.title}
      sub={sub}
      trailing={<Chevron />}
      onPress={onPress}
    />
  );
}

// «matio.tv» for a row's second line — the host, not the scheme.
function webHost(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

const stay = () => {};

function AnonymousAccount() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SCREEN_PAD,
          paddingBottom: clearance + space(4),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.heading, { marginTop: insets.top + space(4), paddingHorizontal: 0 }]}>
          {t.app.tabs.account}
        </Text>

        <View style={{ marginTop: space(6) }}>
          {/* The gate's greeting — the viewer has watched nothing yet — with
              the wall's own CTA. On success the tab simply re-renders as
              the signed-in account: nowhere to go back to. */}
          <SignInForm
            kicker={t.signupWall.gateKicker}
            headline={t.signupWall.headline}
            bodyText={t.signupWall.gateBody}
            cta={t.signupWall.signUpCta}
            onDone={stay}
            signInHint
          />
        </View>

        <View style={{ marginTop: space(8) }}>
          <Card>
            <Row first icon="playback" label={t.app.account.whyKicker} sub={t.app.account.whyBody} />
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3.5),
    paddingHorizontal: SCREEN_PAD,
    marginTop: space(6),
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { ...display, color: colors.goldDeep, fontSize: 28, lineHeight: 32 },
  email: { fontFamily: fonts.bodySemi, color: colors.ink, fontSize: 16 },
  section: { marginTop: space(8) },
  group: { paddingHorizontal: SCREEN_PAD, marginTop: space(4) },
  thumb: { width: 72, height: 42, borderRadius: 8 },
  thumbTrack: {
    position: "absolute",
    left: 4,
    right: 4,
    bottom: 3,
    height: 2,
    backgroundColor: colors.scrimTrack,
    overflow: "hidden",
  },
  thumbFill: { height: "100%", backgroundColor: colors.gold },
});
