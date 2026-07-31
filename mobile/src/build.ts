// This binary's build number. **Bump on every store release.**
//
// The server compares it against AppConfig.minSupportedBuild and the app
// hard-blocks when it falls behind (see src/api/config-context.tsx). That is
// the only mechanism able to retire a client whose users will otherwise sit on
// an old binary for months, so it has to be right from the first release —
// there is no way to retrofit it onto builds already in the wild.
export const APP_BUILD = 1;
