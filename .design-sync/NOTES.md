# design-sync: заметки прогонов

## Прогон 15.08.2026 (первичный импорт)

- **[GENERAL] Статическая сборка Storybook мертва в чистом браузере**: истории
  импортируют `storybook/test` / `vitest` (через `lab/golden.ts`) на уровне
  модуля, и инициализация vitest-expect падает («customEqualityTesters»).
  Под vitest-раннером (pnpm lab / test:stories / CI) всё работает — ломается
  только статика. Решение: reference собирается ИЗ `.design-sync/sb-config/`
  (без addon-vitest/chromatic + vite-алиасы storybook/test и vitest на
  `test-shim.ts`). Заведена issue в трекере репо.
- **[GENERAL] Декоратор из preview.tsx не бандлится**, потому что наш
  `sb-config/preview.tsx` — голый реэкспорт: детектор конвертера ищет слово
  «decorators» в тексте файла. Решение: `cfg.provider = MatioTheme`
  (`.design-sync/theme.tsx`, экспортирован из entry.ts) — он же кормит
  README/prompt-доки обёртки.
- **[GENERAL] Шрифты next/font не попадают в срезанный CSS**: vite-плагин
  инжектит @font-face через JS. Решение: правила извлечены из
  `sb-reference/assets/iframe-*.js` в `.design-sync/fonts.css`
  (`cfg.extraFonts`); адреса — fonts.gstatic.com (Geist/Geist Mono/Anton).
- **Приложение, а не пакет**: экспорты для конвертера объявлены в
  `.design-sync/entry.ts`; поле `"types"` в package.json указывает на него
  (это вход exportedNames). Новая история в Lab → новый экспорт в entry.ts.
- `titleMap: {"Designtokens": null}` — лист токенов исключён из компонентов;
  палитра задокументирована в conventions.md.
- `overrides.Poster.cardMode: "column"` — [GRID_OVERFLOW] на AllTones.
- `[RENDER_THIN] SocialIcon` — ложная тревога: чистый SVG без текста,
  эвристика его не видит; визуально рендер полный (триажировано в грейдах).
- `guidelinesGlob: []` — инфраструктурные docs/*.md дизайн-агенту не едут.
- Попутная грабля запуска: после мержей PR, трогающих package.json, в
  основном чекауте нужен `pnpm install` — сборка стенда молча умирала на
  отсутствующем @sentry/nextjs (exit 0 при мёртвом preview!).

## Re-sync risks

- **`.design-sync/fonts.css` — снапшот**: URL gstatic (v5) и набор гарнитур
  зашиты. Смена шрифтов в app/layout.tsx или бамп версий у Google →
  переизвлечь из свежего `sb-reference/assets/iframe-*.js` (механика — в
  заметке выше).
- **`sb-config/main.ts` дублирует глоб историй** боевого main.ts. Новые пути
  историй (не components/** и не lab/**) → добавить в ОБА файла.
- **`entry.ts` растёт руками**: компонент с историей, но без экспорта в
  entry.ts, молча выпадет из синка ([TITLE_UNMAPPED] его назовёт).
- **reference пересобирать** при любом изменении историй/дизайна:
  `npx storybook build -c .design-sync/sb-config -o .design-sync/sb-reference`.
- Grade-кап историй не трогали (все компоненты ≤6 историй).
- `MatioTheme` — рукописный близнец обёртки из .storybook/preview.tsx и
  app/layout.tsx: сменились классы/шрифтовые переменные там → обновить его.
