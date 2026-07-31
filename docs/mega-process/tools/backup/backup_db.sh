#!/usr/bin/env bash
# Дамп боевой БД → шифрование age → S3-совместимое хранилище (Cloudflare R2).
# Запускается workflow'ом db-backup (ежедневно) или руками — см. этап 06 плейбука.
#
# Вход (env):
#   BACKUP_DATABASE_URL    postgres://…  (обычная схема, БЕЗ +asyncpg; обычно через прокси/туннель)
#   BACKUP_AGE_PUBLIC_KEY  получатель age (age1…)
#   R2_BUCKET, R2_ENDPOINT бакет и S3-эндпоинт R2
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  R2-креды (S3 API)
#   BACKUP_PREFIX          префикс ключей в бакете (default: staging)
#   MIN_DUMP_BYTES         нижняя граница размера дампа (default: 10240)
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL не задан}"
: "${BACKUP_AGE_PUBLIC_KEY:?BACKUP_AGE_PUBLIC_KEY не задан}"
: "${R2_BUCKET:?R2_BUCKET не задан}"
: "${R2_ENDPOINT:?R2_ENDPOINT не задан}"

# aws cli ≥2.23 шлёт CRC-чексуммы, которые R2 не поддерживает — только по требованию
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

PREFIX="${BACKUP_PREFIX:-staging}"
MIN_BYTES="${MIN_DUMP_BYTES:-10240}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="${PREFIX}/db-${STAMP}.dump.age"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Managed-Postgres-дистрибутивы (Percona и подобные) предустанавливают свои
# расширения (напр. pg_stat_monitor), и pg_dump честно кладёт их
# CREATE EXTENSION в дамп. В дампе оно бесполезно: на managed-кластере
# расширение создаёт провижининг, а vanilla-postgres restore-пробы его не
# знает — pg_restore --exit-on-error умирает на первом же стейтменте
# (проверено кровью у оригинала). Флаг --exclude-extension есть с PG 17
# (клиент пинуется в workflow). Старые дампы в бакете расширение уже несут —
# их страхует TOC-фильтр restore_check.sh.
pg_dump --dbname="$BACKUP_DATABASE_URL" -Fc --no-password \
  --exclude-extension=pg_stat_monitor --file="$TMP/db.dump"
age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$TMP/db.dump.age" "$TMP/db.dump"

SIZE=$(wc -c <"$TMP/db.dump.age" | tr -d ' ')
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "Дамп подозрительно мал: $SIZE байт (< $MIN_BYTES) — считаем провалом" >&2
  exit 1
fi

aws s3 cp "$TMP/db.dump.age" "s3://$R2_BUCKET/$KEY" --endpoint-url "$R2_ENDPOINT"

# Объект реально лёг и размер совпал
REMOTE=$(aws s3api head-object --bucket "$R2_BUCKET" --key "$KEY" \
  --endpoint-url "$R2_ENDPOINT" --query ContentLength --output text)
if [ "$REMOTE" != "$SIZE" ]; then
  echo "Размер в R2 ($REMOTE) не совпал с локальным ($SIZE)" >&2
  exit 1
fi

echo "OK: s3://$R2_BUCKET/$KEY ($SIZE байт)"
