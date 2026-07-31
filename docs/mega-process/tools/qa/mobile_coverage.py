#!/usr/bin/env python3
"""Покрытие тестов мобильного приложения: фильтр lcov + порог + отчёт.

Образец паттерна «покрытие считаем БЕЗ генерённого и стендового кода»:
генерённые файлы и UI-стенд (галерея компонентов) раздувают знаменатель
и делают процент бессмысленным. Написан под Flutter (lcov из
`flutter test --coverage`); для другого фреймворка сохраните смысл —
исключения, порог-рэтчет, префикс путей — и замените список EXCLUDE
под свой кодоген (React Native: *.generated.ts, storybook/ и т.п.).

Из coverage/lcov.info выбрасывается генерённое и стендовое,
пути префиксуются каталогом приложения в монорепо (git-дифф идёт от корня
репо — нужно diff-cover), итог пишется в lcov.filtered.info.

Порог --fail-under применяется к отфильтрованному покрытию целиком;
разбивка по подкаталогам — в отчёте. Ratchet: порог в CI только повышается.
"""

import argparse
import sys
from pathlib import Path

# Подстройте под свой кодоген и структуру (это Flutter-дефолты):
EXCLUDE = (".g.dart", ".freezed.dart")
EXCLUDE_PARTS = ("lib/core/i18n/generated/", "lib/gallery/", "lib/main_gallery.dart")


def excluded(path: str) -> bool:
    return path.endswith(EXCLUDE) or any(part in path for part in EXCLUDE_PARTS)


def parse(lcov_path: Path, prefix: str) -> tuple[dict[str, tuple[int, int]], list[str]]:
    """Файл → (строк всего, строк покрыто) + отфильтрованные lcov-блоки."""
    files: dict[str, tuple[int, int]] = {}
    out: list[str] = []
    block: list[str] = []
    current = ""
    lf = lh = 0
    keep = True
    for line in lcov_path.read_text().splitlines():
        if line.startswith("SF:"):
            current = line[3:]
            keep = not excluded(current)
            block = [f"SF:{prefix}{current}"]
            lf = lh = 0
            continue
        block.append(line)
        if line.startswith("LF:"):
            lf = int(line[3:])
        elif line.startswith("LH:"):
            lh = int(line[3:])
        elif line == "end_of_record" and keep:
            files[current] = (lf, lh)
            out.extend(block)
    return files, out


def pct(files: dict[str, tuple[int, int]], sub: str = "") -> tuple[int, int, float]:
    lf = sum(v[0] for k, v in files.items() if sub in k)
    lh = sum(v[1] for k, v in files.items() if sub in k)
    return lf, lh, (100.0 * lh / lf if lf else 100.0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lcov", default="app/coverage/lcov.info")
    ap.add_argument("--fail-under", type=float, default=50.0)
    ap.add_argument("--prefix", default="app/")
    ap.add_argument("--markdown", default="")
    args = ap.parse_args()

    lcov_path = Path(args.lcov)
    files, filtered = parse(lcov_path, args.prefix)
    lcov_path.with_name("lcov.filtered.info").write_text("\n".join(filtered) + "\n")

    total_lf, total_lh, total = pct(files)
    rows = [("всего (без генерённого и стенда)", total_lf, total_lh, total)]
    for label, sub in (("features/", "lib/features/"), ("core/", "lib/core/")):
        lf, lh, p = pct(files, sub)
        rows.append((label, lf, lh, p))

    lines = ["| Срез | Строк | Покрыто | % |", "|---|---|---|---|"]
    for label, lf, lh, p in rows:
        lines.append(f"| {label} | {lf} | {lh} | **{p:.1f}%** |")
    report = "\n".join(lines)
    print(report)

    if args.markdown:
        Path(args.markdown).write_text(
            f"### Покрытие приложения (порог {args.fail_under:.0f}%)\n\n{report}\n"
        )

    if total < args.fail_under:
        print(
            f"\nFAIL: покрытие {total:.1f}% ниже порога {args.fail_under:.0f}%",
            file=sys.stderr,
        )
        return 1
    print(f"\nOK: {total:.1f}% >= {args.fail_under:.0f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
