// The one decision behind the Lab's `vitest` shim: apply it or not.
//
// Pure on purpose — `.storybook/main.ts` is loaded by three different
// processes (storybook dev, storybook build, and vitest's own Storybook
// plugin), and only the last one has a vitest runtime for `lab/golden.ts` to
// use. Vitest marks itself with `process.env.VITEST` before it loads any
// config (the same flag `@storybook/addon-vitest` gates its plugin on), so
// that flag is the discriminator. Getting it wrong in either direction is
// silent: shimming under vitest turns every golden into a vacuous pass, not
// shimming outside it kills the render of every story that imports golden.

export type AliasEntry = { find: string | RegExp; replacement: string };
export type AliasOptions =
  | readonly AliasEntry[]
  | Readonly<Record<string, string>>
  | undefined;

// A plain map, not NodeJS.ProcessEnv: Next augments the latter with a
// required NODE_ENV, which would make every test literal a type error.
type Env = Readonly<Record<string, string | undefined>>;

// Bare `vitest` only — `storybook/test` is left real (see test-shim.ts).
export const SHIMMED_MODULES: readonly RegExp[] = [/^vitest$/];

export function underVitest(env: Env = process.env): boolean {
  return Boolean(env.VITEST);
}

/** Vite `resolve.alias` for the Lab: existing aliases plus the shim entries
 *  when not under vitest; untouched when under it. */
export function withLabTestShim(
  alias: AliasOptions,
  shimPath: string,
  env: Env = process.env,
): AliasOptions {
  if (underVitest(env)) return alias;
  const shim = SHIMMED_MODULES.map((find) => ({ find, replacement: shimPath }));
  const existing: readonly AliasEntry[] = Array.isArray(alias)
    ? alias
    : Object.entries(alias ?? {}).map(([find, replacement]) => ({
        find,
        replacement,
      }));
  return [...shim, ...existing];
}
