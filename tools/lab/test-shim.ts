// Inert stand-in for `vitest` OUTSIDE the vitest runner — i.e. in `storybook
// dev` (`pnpm lab`) and `storybook build` (`pnpm lab:build`).
//
// Why it exists: `lab/golden.ts` imports `expect` from `vitest` at module
// level, because `expect.element(...).toMatchScreenshot()` only exists in
// vitest's browser mode. Bundled into a plain Storybook preview, vitest's
// expect initialises against runner state that is not there and throws
// («Cannot read properties of undefined (reading 'customEqualityTesters')»)
// — at IMPORT time, so every story that so much as imports `golden` fails to
// render (#78). `.storybook/main.ts` aliases `vitest` to this module when
// `process.env.VITEST` is unset (see tools/lab/test-shim-alias.ts); under
// vitest the alias is not applied and the real package is used.
//
// What it is NOT: it does not touch `storybook/test` — `expect/fn/userEvent/
// within` from there work in a plain preview, and the Lab keeps its real
// interaction checks in dev mode. Only the screenshot assertion becomes a
// no-op outside the runner, which is the truth anyway: nothing compares
// screenshots there.
//
// Every property access and call returns the same inert callable, and
// `await`-ing it resolves immediately (`then` is deliberately absent — a
// callable `then` would make the await hang forever). A story importing a
// name this file does not export fails the Vite build loudly («is not
// exported by …») — add the export here, do not widen it to `any`.

interface Inert {
  (...args: unknown[]): Inert;
  readonly [key: string]: Inert;
}

const inert: Inert = new Proxy((() => inert) as unknown as Inert, {
  get: (_target, prop) => (prop === "then" ? undefined : inert),
  apply: () => inert,
});

export const expect: Inert = inert;
