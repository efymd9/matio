// Инертная заглушка storybook/test и vitest для reference-сборки design-sync.
//
// Зачем: истории Lab импортируют expect/fn/userEvent/within (и golden() тянет
// vitest) на уровне модуля. Под vitest-раннером это работает; в статической
// сборке инициализация vitest-expect падает («customEqualityTesters»), убивая
// РЕНДЕР всех историй. Reference-сборке play-проверки не нужны — ей нужен
// внешний вид. Заглушка даёт модулям загрузиться и рендерить; play-функции
// исполняются как no-op. Боевой стенд (pnpm lab / test:stories) её не видит.
const chain: any = new Proxy(() => chain, {
  get: () => chain,
  apply: () => chain,
});
export const expect: any = Object.assign((..._: unknown[]) => chain, {
  element: () => chain,
  extend: () => {},
});
export const fn = () => {
  const f: any = (..._: unknown[]) => undefined;
  f.mock = { calls: [] };
  return f;
};
export const userEvent: any = chain;
export const within = (_el?: unknown): any => chain;
export const waitFor = async (cb: () => unknown) => cb();
export default { expect, fn, userEvent, within, waitFor };
