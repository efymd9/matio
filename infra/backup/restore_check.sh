#!/usr/bin/env bash
# Restore-проба: свежий дамп из Vercel Blob → расшифровка → pg_restore в ПУСТУЮ
# базу → smoke-запросы. Запускается воркфлоу db-restore-check (ежемесячно) или
# руками — см. docs/runbooks/db-restore.md.
#
# СМЫСЛ: бэкап, который никто не пробовал восстановить, — это лотерея, а не
# бэкап. Проба заодно ловит мёртвый db-backup: старый дамп валит её так же
# громко, как битый (проверка свежести ниже).
#
# Вход (env):
#   BLOB_READ_WRITE_TOKEN   токен стора Vercel Blob
#   BACKUP_AGE_SECRET_KEY   приватный age-ключ (содержимое, AGE-SECRET-KEY-…)
#   RESTORE_DATABASE_URL    postgres://… — ПУСТАЯ БД, куда восстанавливаем
#   BACKUP_PREFIX           префикс ключей (default: db-backups/production)
#   MAX_DUMP_AGE_HOURS      допустимый возраст последнего дампа (default: 48)
#   MIN_TABLES              минимум таблиц после restore (default: 15)
#   MIN_MIGRATIONS          минимум записей в drizzle.__drizzle_migrations (default: 1)
#   MIN_USERS / MIN_SHOWS / MIN_EPISODES  минимум строк (default: 1; 0 — пропустить)
#   BACKUP_BLOB_CLI         чем вызывать blob.ts (см. backup_db.sh)
set -euo pipefail

: "${BLOB_READ_WRITE_TOKEN:?BLOB_READ_WRITE_TOKEN не задан}"
: "${BACKUP_AGE_SECRET_KEY:?BACKUP_AGE_SECRET_KEY не задан}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL не задан}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PREFIX="${BACKUP_PREFIX:-db-backups/production}"
MAX_AGE_HOURS="${MAX_DUMP_AGE_HOURS:-48}"
MIN_TABLES="${MIN_TABLES:-15}"
MIN_MIGRATIONS="${MIN_MIGRATIONS:-1}"
MIN_USERS="${MIN_USERS:-1}"
MIN_SHOWS="${MIN_SHOWS:-1}"
MIN_EPISODES="${MIN_EPISODES:-1}"
BLOB_CLI="${BACKUP_BLOB_CLI:-pnpm --silent exec tsx infra/backup/blob.ts}"

# Расшифрованный дамп живёт ТОЛЬКО здесь и только на время прогона: mktemp
# кладёт каталог вне рабочей директории, поэтому его физически не может забрать
# upload-artifact, а trap сносит его в любом исходе. В дампе персональные
# данные — в артефакты и логи он не попадает никогда.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "pg_restore: $(pg_restore --version)"

# Проба обязана идти в ПУСТУЮ базу: восстановление поверх существующих таблиц
# частью упало бы, частью легло, и вердикт «OK» ничего бы не значил.
EXISTING=$(psql "$RESTORE_DATABASE_URL" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$EXISTING" != "0" ]; then
  echo "Целевая база не пуста: в public уже $EXISTING таблиц — проба идёт только в чистую БД" >&2
  exit 1
fi

# shellcheck disable=SC2086 # BLOB_CLI — команда со своими аргументами
LATEST=$($BLOB_CLI latest "${PREFIX}/")
KEY=$(printf '%s' "$LATEST" | cut -f1)
MODIFIED=$(printf '%s' "$LATEST" | cut -f2)
SIZE=$(printf '%s' "$LATEST" | cut -f3)
echo "Последний дамп: $KEY ($MODIFIED, $SIZE байт)"

# Свежесть. Мёртвый db-backup обязан валить и пробу: «восстановили прошлогоднюю
# копию» — это тот же инцидент потери данных, только с зелёной галочкой.
AGE_HOURS=$(python3 - "$MODIFIED" <<'EOF'
import sys
from datetime import datetime, timezone

modified = datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
print(int((datetime.now(timezone.utc) - modified).total_seconds() // 3600))
EOF
)
if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  echo "Последний дамп старше ${MAX_AGE_HOURS}ч (возраст ${AGE_HOURS}ч) — db-backup мёртв?" >&2
  exit 1
fi

# shellcheck disable=SC2086
$BLOB_CLI fetch "$KEY" "$TMP/db.dump.age" >/dev/null

KEYFILE="$TMP/age.key"
touch "$KEYFILE" && chmod 600 "$KEYFILE"
printf '%s\n' "$BACKUP_AGE_SECRET_KEY" >"$KEYFILE"
age -d -i "$KEYFILE" -o "$TMP/db.dump" "$TMP/db.dump.age"
rm -f "$KEYFILE"

# TOC-фильтр расширений (из плейбука, оплачено кровью оригинала): дамп может
# нести CREATE EXTENSION, которого нет в vanilla-контейнере пробы, и
# pg_restore --exit-on-error умирает на первом же стейтменте. Наша схема
# расширений не создаёт, но фильтр оставлен намеренно: включат когда-нибудь
# расширение на стороне Neon — проба не должна покраснеть по этой причине.
# Схема приложения от объектов расширений не зависит; появится зависимость —
# --exit-on-error честно упадёт на зависимом объекте, а не молча. Сам
# --exit-on-error не ослабляем.
# Формат строки TOC: <dumpId>; <catalogOid> <objOid> <тип> <схема> <имя> <владелец>,
# у EXTENSION-записей вместо схемы «-»; COMMENT ON EXTENSION — тип COMMENT
# с именем «EXTENSION <имя>».
pg_restore -l "$TMP/db.dump" >"$TMP/db.toc"
TOC_EXT_RE='^[0-9]+; [0-9]+ [0-9]+ (EXTENSION |COMMENT - EXTENSION )'
if grep -E "$TOC_EXT_RE" "$TMP/db.toc" >"$TMP/db.toc.cut"; then
  echo "TOC-фильтр вырезал записи расширений:"
  cat "$TMP/db.toc.cut"
fi
grep -vE "$TOC_EXT_RE" "$TMP/db.toc" >"$TMP/db.toc.keep" || true
if [ ! -s "$TMP/db.toc.keep" ]; then
  echo "После TOC-фильтра восстанавливать нечего — дамп пуст или битый" >&2
  exit 1
fi

pg_restore --no-owner --no-privileges --exit-on-error \
  --use-list="$TMP/db.toc.keep" \
  --dbname="$RESTORE_DATABASE_URL" "$TMP/db.dump"

# Smoke. Инструмент миграций у нас Drizzle, а не Alembic из шаблона: голова
# миграций лежит в drizzle.__drizzle_migrations (СХЕМА drizzle, не public —
# в счёт таблиц public она не попадает).
# ПРИВАТНОСТЬ: наружу идут только числа. Ни одной строки данных.
MIGRATIONS=$(psql "$RESTORE_DATABASE_URL" -tAc \
  "SELECT count(*) FROM drizzle.__drizzle_migrations")
if [ "$MIGRATIONS" -lt "$MIN_MIGRATIONS" ]; then
  echo "Записей о миграциях: $MIGRATIONS (< $MIN_MIGRATIONS) — restore неполный" >&2
  exit 1
fi

TABLES=$(psql "$RESTORE_DATABASE_URL" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$TABLES" -lt "$MIN_TABLES" ]; then
  echo "Таблиц после restore: $TABLES (< $MIN_TABLES)" >&2
  exit 1
fi

# Главные таблицы продукта: каталог (shows/episodes) и аккаунты (users).
# Пустая таблица при целой схеме — это «восстановили structure-only», самый
# коварный вид мёртвого бэкапа.
check_rows() {
  local table="$1" minimum="$2" count
  [ "$minimum" -gt 0 ] || return 0
  count=$(psql "$RESTORE_DATABASE_URL" -tAc "SELECT count(*) FROM $table")
  if [ "$count" -lt "$minimum" ]; then
    echo "В $table $count строк (< $minimum) — данные не восстановились" >&2
    exit 1
  fi
  printf '%s' "$count"
}

SHOWS=$(check_rows shows "$MIN_SHOWS")
EPISODES=$(check_rows episodes "$MIN_EPISODES")
USERS=$(check_rows users "$MIN_USERS")

echo "OK: restore-проба пройдена (миграции $MIGRATIONS, таблиц $TABLES, shows ${SHOWS:-—}, episodes ${EPISODES:-—}, users ${USERS:-—})"
