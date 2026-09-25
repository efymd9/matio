import Constants from "expo-constants";

// This binary's build number: the native one (CFBundleVersion on iOS,
// versionCode on Android), which EAS stamps on every store build
// (`appVersionSource: remote` + `autoIncrement` in eas.json) — the same
// number Settings → Version shows. Nothing to bump by hand.
//
// The server compares it against AppConfig.minSupportedBuild and the app
// hard-blocks when it falls behind (see src/api/config-context.tsx). That is
// the only mechanism able to retire a client whose users will otherwise sit on
// an old binary for months, so it has to be right from the first release —
// there is no way to retrofit it onto builds already in the wild.
//
// Under remote versioning iOS and Android keep SEPARATE counters, while
// APP_MIN_SUPPORTED_BUILD is one number for both: check both platforms'
// current builds before raising it. Where there is no native build number to
// read (null) or it is not a number, it reads as 1 — the old literal, below
// any store build.
export const APP_BUILD = Number.parseInt(Constants.nativeBuildVersion ?? "", 10) || 1;
