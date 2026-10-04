import { useAuth, useClerk, useUser } from "@clerk/expo";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, settleOr } from "@/api/client";
import { useOptionalAuth } from "@/auth/clerk";
import { AuthStalled } from "@/components/auth-stalled";
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
// are mid-way through, the way out — sign out, or delete the account (#309).
// Signed out: the sign-up wall's copy as a
// calm tab — the same two-step email → code form the locked-episode screen
// uses — and one card on why an account is worth having.
//
// No «Manage subscription» row (#292): it opened matio.tv signed out, in a
// browser with its own cookies, and offered a free member a subscription
// they do not have. It comes back once /v1 says who is a subscriber
// (registry); until then cancelling stays on the site.

export default function AccountScreen() {
  const { isLoaded, isSignedIn, stalled, retry } = useOptionalAuth();
  // Clerk answers a beat after mount; a signed-out frame that flips to
  // signed-in is worse than a spinner. A spinner that never ends is worse
  // than either (#253): once the hook gives up, say so and offer a retry.
  if (!isLoaded) return stalled ? <StalledAccount onRetry={retry} /> : <Loading />;
  return isSignedIn ? <SignedInAccount /> : <AnonymousAccount />;
}

// Clerk did not load (a vendor 400, no network, an outage — #253). Same
// frame as the signed-out tab, with the honest state where the form would
// be — the key-less build's look (#247), plus a retry.
function StalledAccount({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingHorizontal: SCREEN_PAD, paddingBottom: clearance + space(4) }}
    >
      <Text style={[styles.heading, { marginTop: insets.top + space(4), paddingHorizontal: 0 }]} accessibilityRole="header">
        {t.app.tabs.account}
      </Text>
      <View style={{ marginTop: space(6) }}>
        <AuthStalled onRetry={onRetry} />
      </View>
    </ScrollView>
  );
}

// How long a failed deletion waits for Clerk's word on the session (#336)
// before it settles for the honest failure. Clerk on its own keeps retrying a
// network failure for far longer than a viewer should stare at «Please wait».
const SESSION_CHECK_TIMEOUT_MS = 5_000;

type SessionState = "live" | "gone" | "unknown";

// Clerk's answer about the session, fetched fresh (skipCache — a cached token
// would outlive the account by up to a minute). No session or no token, or
// Clerk refusing the session itself (401 / 404 from its API) → gone: the
// session ended — with the account only if a deletion request went out (the
// caller's check, #398). A token → live. Anything else — offline, a
// 5xx, a 429, no answer in time — is not an answer, and nothing is concluded
// from it.
function sessionState(getToken: ReturnType<typeof useAuth>["getToken"]): Promise<SessionState> {
  const probe = Promise.resolve()
    .then(() => getToken({ skipCache: true }))
    .then(
      (token): SessionState => (token ? "live" : "gone"),
      (err: unknown): SessionState => {
        const status = (err as { status?: unknown } | null)?.status;
        return status === 401 || status === 404 ? "gone" : "unknown";
      },
    );
  return settleOr(probe, SESSION_CHECK_TIMEOUT_MS, "unknown" as const);
}

// Rendered only under a live session, so Clerk's hooks are safe here: the
// provider is mounted whenever isSignedIn can be true.
function SignedInAccount() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const { items: resume } = useContinueWatching(true);
  const [deleting, setDeleting] = useState(false);
  // Whether a deletion request carrying the session's Bearer has left the app
  // in this mount — this tap's or an earlier one's (#398). Only such a request
  // can have erased the account.
  const deleteSent = useRef(false);

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

  // One stray tap must not end a passwordless session — getting back in is
  // an email round trip — so the system dialog asks first (#292). A sign-out
  // that fails (offline) says so instead of doing nothing.
  const confirmSignOut = useCallback(() => {
    const signOutOrSay = async () => {
      try {
        await signOut();
      } catch {
        Alert.alert(t.app.account.signOutFailed, t.app.account.stalledBody);
      }
    };
    Alert.alert(t.app.account.signOutConfirmTitle, t.app.account.signOutConfirmBody, [
      { text: t.app.common.cancel, style: "cancel" },
      { text: t.app.account.signOut, style: "destructive", onPress: () => void signOutOrSay() },
    ]);
  }, [signOut, t]);

  // «Delete account» (#309, App Store 5.1.1(v)). Nothing comes back, so two
  // system dialogs ask first: what is erased and what happens to a
  // subscription (cancelled at the end of its period), then that it is final.
  // The server erases our side and then the Clerk account; its {ok:true}
  // signs the app out and goes Home.
  //
  // A failed request is not proof the deletion failed (#336): the server may
  // have finished while its answer was lost (the 45s deadline, a dropped
  // connection), or a retry went out with no token because Clerk had no
  // session left to give (401). So a failure asks Clerk about the session
  // before saying anything. Live, or no answer → the honest failure as
  // before: the session is kept, and the row can simply be tapped again,
  // because both halves on the server are idempotent. Gone → the account is
  // gone, as asked: sign out and go Home, exactly as on success — but only
  // once a request carrying the session has gone out (#398). A session can
  // also end on its own — revoked from another device, at the end of its
  // lifetime — before clerk-js unmounts this tab; then nothing was sent that
  // could erase anything (no token, or an anonymous 401), the account is
  // intact, and the viewer is told so and signed out: the tab turns into the
  // sign-in form, and a fresh session can delete.
  const confirmDelete = useCallback(() => {
    const deleteOrSay = async () => {
      setDeleting(true);
      try {
        await api.deleteAccount({
          onSentWithToken: () => {
            deleteSent.current = true;
          },
        });
      } catch {
        if ((await sessionState(getToken)) !== "gone") {
          setDeleting(false);
          Alert.alert(t.app.account.deleteFailed, t.app.account.stalledBody);
          return;
        }
        if (!deleteSent.current) {
          setDeleting(false);
          try {
            await signOut();
          } catch {
            // A dead session Clerk drops on its own next refresh.
          }
          Alert.alert(t.app.account.deleteSessionEndedTitle, t.app.account.deleteSessionEndedBody);
          return;
        }
      }
      // The account no longer exists at Clerk: the local sign-out only tidies
      // up. One that fails leaves a dead session Clerk drops on its next token
      // refresh — never a reason to say the deletion failed.
      try {
        await signOut();
      } catch {
        // see above
      }
      router.replace("/");
    };
    const confirmFinal = () =>
      Alert.alert(t.app.account.deleteFinalTitle, t.app.account.deleteFinalBody, [
        { text: t.app.common.cancel, style: "cancel" },
        {
          text: t.app.account.deleteFinalCta,
          style: "destructive",
          onPress: () => void deleteOrSay(),
        },
      ]);
    Alert.alert(t.app.account.deleteConfirmTitle, t.app.account.deleteConfirmBody, [
      { text: t.app.common.cancel, style: "cancel" },
      { text: t.app.account.deleteAccount, style: "destructive", onPress: confirmFinal },
    ]);
  }, [getToken, router, signOut, t]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: clearance + space(4) }}
    >
      <Text style={[styles.heading, { marginTop: insets.top + space(4) }]} accessibilityRole="header">
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

      <View style={styles.group}>
        <Card>
          <Row first label={t.app.account.signOut} danger onPress={confirmSignOut} />
          {/* While the request is out the row is not pressable — a second
              chain of dialogs would only send the same deletion again. */}
          <Row
            label={t.app.account.deleteAccount}
            sub={deleting ? t.app.common.pleaseWait : undefined}
            danger
            onPress={deleting ? undefined : confirmDelete}
            accessibilityLabel={t.app.account.deleteAccount}
          />
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
            displayWidth={THUMB_W}
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
        <Text style={[styles.heading, { marginTop: insets.top + space(4), paddingHorizontal: 0 }]} accessibilityRole="header">
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

// The continue row's thumb, in points.
const THUMB_W = 72;

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
  thumb: { width: THUMB_W, height: 42, borderRadius: 8 },
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
