#!/usr/bin/env bash
# Дамп боевой БД → шифрование age → Vercel Blob (приватный объект) → уборка
# ретеншена. Запускается воркфлоу db-backup (ежедневно) или руками — см.
# docs/runbooks/db-restore.md и этап 06 плейбука (docs/mega-process/06-data.md).
#
# ОТЛИЧИЯ ОТ ПЛЕЙБУКА (решение владельца в issue #35, 05.08.2026):
#   * хранилище — Vercel Blob, а не Cloudflare R2: Blob уже подключён к
#     проекту, поэтому проба восстановления появляется сегодня, без онбординга
#     нового вендора. Копии всё равно лежат ВНЕ Neon. Цена решения: доступ к
#     аккаунту Vercel = доступ и к приложению, и к бэкапам (один радиус
#     поражения вместо двух). Переезд на R2 позже — замена вызовов blob.ts;
#   * у Blob НЕТ lifecycle-правил S3/R2 — ретеншен выполняет этот скрипт
#     (`blob.ts prune`). Уберёшь шаг — дампы копятся вечно;
#   * заливка идёт через SDK (`infra/backup/blob.ts`), а не `aws s3 cp`.
#
# Вход (env):
#   BACKUP_DATABASE_URL     postgres://… — ПРЯМОЙ (не пулерный) эндпоинт Neon.
#                           Через пулер в transaction-режиме pg_dump не работает.
#   BACKUP_AGE_PUBLIC_KEY   получатель age (age1…)
#   BLOB_READ_WRITE_TOKEN   токен стора Vercel Blob
#   BACKUP_PREFIX           префикс ключей (default: db-backups/production)
#   MIN_DUMP_BYTES          нижняя граница размера дампа (default: 65536)
#   BACKUP_RETENTION_DAYS   сколько дней хранить (default: 35)
#   BACKUP_BLOB_CLI         чем вызывать blob.ts (default: pnpm exec tsx …).
#                           Точка подмены для локальной репетиции на файловой
#                           заглушке — чтобы не писать в боевой стор ради теста.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL не задан}"
: "${BACKUP_AGE_PUBLIC_KEY:?BACKUP_AGE_PUBLIC_KEY не задан}"
: "${BLOB_READ_WRITE_TOKEN:?BLOB_READ_WRITE_TOKEN не задан}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PREFIX="${BACKUP_PREFIX:-db-backups/production}"
MIN_BYTES="${MIN_DUMP_BYTES:-65536}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-35}"
BLOB_CLI="${BACKUP_BLOB_CLI:-pnpm --silent exec tsx infra/backup/blob.ts}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="${PREFIX}/db-${STAMP}.dump.age"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ГРАБЛЯ ПЛЕЙБУКА, ОПЛАЧЕННАЯ КРОВЬЮ: Debian-обёртка /usr/bin/pg_dump сама
# выбирает версию клиента, и на раннере это оказывается не мажор сервера. У нас
# сервер — Postgres 18 (Neon), поэтому воркфлоу пинует реальные бинарники
# (/usr/lib/postgresql/18/bin в $GITHUB_PATH), а скрипт печатает версию в лог:
# «дамп не восстанавливается» через полгода расследуется по этой строке за минуту.
echo "pg_dump: $(pg_dump --version)"
echo "age: $(age --version 2>/dev/null || echo 'версия неизвестна')"

# Расширения НЕ исключаем (в отличие от шаблона плейбука с его
# --exclude-extension=pg_stat_monitor): у Neon наша схема не создаёт ни одного
# расширения (`grep -r 'CREATE EXTENSION' drizzle/` пуст), а настоящий дамп
# обязан быть верной копией. Совместимость с vanilla-контейнером пробы решает
# TOC-фильтр в restore_check.sh — там, где она и нужна.
pg_dump --dbname="$BACKUP_DATABASE_URL" -Fc --no-password --file="$TMP/db.dump"

# Шифруем ДО загрузки и только так. В дампе — почта живых аккаунтов и история
# просмотров; незашифрованная копия не должна существовать нигде, кроме
# временного каталога этого прогона (его сносит trap).
age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$TMP/db.dump.age" "$TMP/db.dump"

SIZE=$(wc -c <"$TMP/db.dump.age" | tr -d ' ')
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "Дамп подозрительно мал: $SIZE байт (< $MIN_BYTES) — считаем провалом" >&2
  exit 1
fi

# shellcheck disable=SC2086 # BLOB_CLI — это команда со своими аргументами
UPLOADED=$($BLOB_CLI put "$TMP/db.dump.age" "$KEY")
REMOTE_SIZE=$(printf '%s' "$UPLOADED" | cut -f2)
if [ "$REMOTE_SIZE" != "$SIZE" ]; then
  echo "Размер в хранилище ($REMOTE_SIZE) не совпал с локальным ($SIZE)" >&2
  exit 1
fi
echo "OK: $KEY ($SIZE байт)"

# Уборка ретеншена — ПОСЛЕ подтверждённой загрузки, чтобы неудачная заливка не
# успела удалить старые копии. Провал уборки валит прогон намеренно: тихое
# предупреждение в логе, который никто не читает, — это и есть «бэкапы копятся
# вечно, пока не кончится квота». Сообщение честно говорит, что сам дамп уже лёг.
# shellcheck disable=SC2086
if ! $BLOB_CLI prune "${PREFIX}/" "$RETENTION_DAYS"; then
  echo "Дамп $KEY загружен, но уборка ретеншена (${RETENTION_DAYS} дней) упала" >&2
  exit 1
fi
