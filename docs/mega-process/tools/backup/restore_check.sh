#!/usr/bin/env bash
# Restore-проба: свежий дамп из R2 → расшифровка → pg_restore в пустую БД → smoke.
# Запускается workflow'ом db-restore-check (ежемесячно) или руками.
# Смысл: бэкап, который никто не пробовал восстановить, — это лотерея,
# а не бэкап. Проба заодно ловит мёртвый db-backup (проверка свежести).
#
# Вход (env):
#   R2_BUCKET, R2_ENDPOINT                бакет и S3-эндпоинт R2
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  R2-креды (S3 API)
#   BACKUP_AGE_SECRET_KEY                 приватный age-ключ (содержимое, AGE-SECRET-KEY-…)
#   RESTORE_DATABASE_URL                  postgres://… — ПУСТАЯ БД, куда восстанавливаем
#   BACKUP_PREFIX                         префикс ключей (default: staging)
#   MAX_DUMP_AGE_HOURS                    свежесть последнего дампа (default: 48)
#   MIN_TABLES                            минимум таблиц после restore (default: 15)
#   MIN_USERS                             минимум строк в users (default: 1; 0 — пропустить)
set -euo pipefail

: "${R2_BUCKET:?R2_BUCKET не задан}"
: "${R2_ENDPOINT:?R2_ENDPOINT не задан}"
: "${BACKUP_AGE_SECRET_KEY:?BACKUP_AGE_SECRET_KEY не задан}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL не задан}"

export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

PREFIX="${BACKUP_PREFIX:-staging}"
MAX_AGE_HOURS="${MAX_DUMP_AGE_HOURS:-48}"
MIN_TABLES="${MIN_TABLES:-15}"
MIN_USERS="${MIN_USERS:-1}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Ключи содержат UTC-таймстемп → лексикографический максимум = самый свежий.
# Дампов в бакете ~retention-дней, в одну страницу листинга умещаемся с запасом.
# Пустой бакет: Contents = null → sort_by(null) падает стектрейсом JMESPath;
# `Contents || пустой список` даёт «None» текстом, который ловим ниже
# (проверено кровью у оригинала).
read -r KEY MODIFIED < <(aws s3api list-objects-v2 --bucket "$R2_BUCKET" \
  --prefix "$PREFIX/" --endpoint-url "$R2_ENDPOINT" \
  --query 'sort_by(Contents || `[]`, &Key)[-1].[Key, LastModified]' --output text)
if [ -z "${KEY:-}" ] || [ "$KEY" = "None" ]; then
  echo "В s3://$R2_BUCKET/$PREFIX/ нет ни одного дампа — проверь db-backup" >&2
  exit 1
fi
echo "Последний дамп: $KEY ($MODIFIED)"

# Свежесть: мёртвый db-backup должен провалить и restore-пробу
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

aws s3 cp "s3://$R2_BUCKET/$KEY" "$TMP/db.dump.age" --endpoint-url "$R2_ENDPOINT"

KEYFILE="$TMP/age.key"
touch "$KEYFILE" && chmod 600 "$KEYFILE"
printf '%s\n' "$BACKUP_AGE_SECRET_KEY" >"$KEYFILE"
age -d -i "$KEYFILE" -o "$TMP/db.dump" "$TMP/db.dump.age"

# Дампы с managed-Postgres (Percona-дистрибутивы и подобные) могут нести
# CREATE EXTENSION предустановленных там расширений, которых нет в
# vanilla-контейнере пробы — pg_restore --exit-on-error падал на первом же
# стейтменте (проверено кровью у оригинала). Свежие дампы пишутся с
# --exclude-extension (backup_db.sh), но retention длинный: проба обязана
# восстанавливать и старые. Поэтому режем ЛЮБЫЕ EXTENSION-записи через
# TOC-фильтр (pg_restore -l → выкинуть EXTENSION и COMMENT ON EXTENSION →
# pg_restore -L): расширения — обвязка дистрибутива сервера, схема приложения
# от их объектов не зависит; появится зависимость — --exit-on-error честно
# упадёт на зависимом объекте, а не молча. Сам --exit-on-error не ослабляем.
# Формат строки TOC: <dumpId>; <catalogOid> <objOid> <тип> <схема> <имя> <владелец>,
# у EXTENSION-записей вместо схемы «-»; COMMENT ON EXTENSION — тип COMMENT
# с именем «EXTENSION <имя>».
pg_restore -l "$TMP/db.dump" >"$TMP/db.toc"
TOC_EXT_RE='^[0-9]+; [0-9]+ [0-9]+ (EXTENSION |COMMENT - EXTENSION )'
if grep -E "$TOC_EXT_RE" "$TMP/db.toc" >"$TMP/db.toc.cut"; then
  echo "TOC-фильтр вырезал записи расширений:"
  cat "$TMP/db.toc.cut"
fi
grep -vE "$TOC_EXT_RE" "$TMP/db.toc" >"$TMP/db.toc.keep"

pg_restore --no-owner --no-privileges --exit-on-error \
  --use-list="$TMP/db.toc.keep" \
  --dbname="$RESTORE_DATABASE_URL" "$TMP/db.dump"

# Smoke: схема на месте (голова миграций), таблиц не меньше ожидаемого, данные живы.
# alembic_version — для Alembic; другой инструмент миграций → замените запрос
# (Django: django_migrations, Prisma: _prisma_migrations и т.п.).
VERSION_NUM=$(psql "$RESTORE_DATABASE_URL" -tAc "SELECT version_num FROM alembic_version")
if [ -z "$VERSION_NUM" ]; then
  echo "alembic_version пуста — restore неполный" >&2
  exit 1
fi
TABLES=$(psql "$RESTORE_DATABASE_URL" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$TABLES" -lt "$MIN_TABLES" ]; then
  echo "Таблиц после restore: $TABLES (< $MIN_TABLES)" >&2
  exit 1
fi
if [ "$MIN_USERS" -gt 0 ]; then
  USERS=$(psql "$RESTORE_DATABASE_URL" -tAc "SELECT count(*) FROM users")
  if [ "$USERS" -lt "$MIN_USERS" ]; then
    echo "В users $USERS строк (< $MIN_USERS) — данные не восстановились" >&2
    exit 1
  fi
fi

echo "OK: restore-проба пройдена (миграции $VERSION_NUM, таблиц $TABLES)"
