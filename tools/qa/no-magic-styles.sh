#!/usr/bin/env bash
# Механический запрет «магии» в фичах: цветовой литерал не имеет права
# появиться в пользовательских компонентах — только токены дизайн-системы
# (@theme в app/globals.css: gold, cream, espresso, burgundy, rust, …).
#
# ПОЧЕМУ ИМЕННО ЭТО: дизайн-система разрушается не одним махом, а по одному
# `bg-[#3a2a1e]` за PR. Через полгода «золотой» в проекте четырёх оттенков, и
# никто не помнит, какой правильный. Ревьюер такое пропускает — он смотрит на
# логику; grep не пропускает никогда.
#
# ЧТО ПРОВЕРЯЕТСЯ — четыре пласта, по одной регулярке на каждый (PATTERNS
# ниже):
#   1. произвольные значения Tailwind с цветовым литералом (`bg-[#…]`,
#      `text-[rgb(…)]`, `border-[oklch(…)]`) — ноль с 31.07.2026;
#   2. цвет в пропе (`color="#f6efe4"`, `fill=`, `stroke=`, в том числе
#      `color={cond ? "#…" : …}`) — иконка берёт `currentColor`, цвет задаёт
#      класс-токен на родителе или на самой иконке (`className="text-gold"`);
#      образец — components/site/share-button.tsx;
#   3. произвольные тени `shadow-[…]` (и `drop-shadow-[…]`, `text-shadow-[…]`)
#      — только токены `--shadow-*` из @theme: shadow-cta, shadow-play,
#      shadow-card, shadow-poster, shadow-popup, shadow-hover-card,
#      shadow-sheet, shadow-dialog;
#   4. градиенты с цветовым литералом в inline-стилях — константы в
#      lib/design.ts рядом с TONE_GRADIENT (HERO_SCRIM_BOTTOM/SIDE,
#      SHOW_HERO_SCRIM, WALL_SCRIM, GOLD_GLOW, BURGUNDY_GLOW, OG_*).
# Пласты 2–4 были долгом (#31: хардкоды в пропах, тени, градиенты) и въехали
# сюда тем же PR, что его закрыл, — иначе долг возвращается по одному
# литералу за PR.
#
# ЧТО НЕ ЛОВИТСЯ (осознанно): градиент, разбитый на несколько строк (grep
# построчный — не разбивайте), и цвета в inline-стилях вне градиентов
# (`--media-*` переменные media-chrome в player.tsx, Satori-стили OG-картинки)
# — этот хвост записан в docs/registry.md.
#
# АДМИНКА (components/admin) НЕ сканируется: её SVG-графики строят палитры
# программно, и это внутренний инструмент, а не бренд.
set -uo pipefail

SCAN_DIRS=(
  "components/site"
  "components/watch"
  "app/(public)"
  "app/watch"
)

# Цветовой литерал: #hex, rgb(…, rgba(…, hsl(…, oklch(…
COLOR_LITERAL='(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\()'

# Параллельные массивы: подпись для отчёта и регулярка (ERE). `\b` намеренно
# не используется — BSD grep на macOS его не знает, граница слова задана явно.
LABELS=(
  'цветовой литерал в произвольном значении Tailwind (-[#…], -[rgb(…)'
  'цвет в пропе (color="#…", fill=, stroke=) — currentColor + класс-токен на родителе'
  'произвольная тень shadow-[…] — только токены --shadow-* из @theme'
  'градиент с цветовым литералом в inline-стиле — константы в lib/design.ts'
)
PATTERNS=(
  "-\[${COLOR_LITERAL}"
  "(^|[^[:alnum:]_-])(color|fill|stroke)=(\"#[0-9a-fA-F]{3,8}|\{[^}]*\"#[0-9a-fA-F]{3,8})"
  'shadow-\['
  "gradient\([^)]*${COLOR_LITERAL}"
)

# Файлы отбираются через find, а не через grep --include: у ugrep (частый
# локальный дублёр grep на macOS) --include другой семантики, и чек молча
# сканировал не то. Паттерн передаётся через -e — первый начинается с дефиса
# и иначе уезжает в опции grep. Обе грабли пойманы при установке чека.
found=0
for i in "${!PATTERNS[@]}"; do
  labeled=0
  for dir in "${SCAN_DIRS[@]}"; do
    [ -d "$dir" ] || continue
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      if [ "$found" -eq 0 ]; then
        echo "✗ Магия в фичах — используйте токены дизайн-системы:"
      fi
      found=1
      if [ "$labeled" -eq 0 ]; then
        echo
        echo "  [${LABELS[$i]}]"
        labeled=1
      fi
      echo "  $hit"
    done < <(
      find "$dir" -type f -name '*.tsx' ! -name '*.stories.tsx' -print0 \
        | xargs -0 grep -nHE -e "${PATTERNS[$i]}" 2>/dev/null
    )
  done
done

if [ "$found" -eq 1 ]; then
  echo
  echo "Замените литерал на токен из app/globals.css (@theme): text-gold,"
  echo "bg-espresso-2, border-rust/30, shadow-cta и т.д.; градиент — на"
  echo "константу из lib/design.ts. Нужного значения нет — оно добавляется в"
  echo "@theme (или lib/design.ts) И в таблицу lab/tokens.stories.tsx тем же"
  echo "PR, чтобы система оставалась одним источником правды."
  exit 1
fi

echo "✓ Цветовых литералов, произвольных теней и градиентов в фичах нет"
