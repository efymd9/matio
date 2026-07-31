#!/usr/bin/env bash
# Одноразовая настройка R2 под дампы БД: bucket + lifecycle (retention).
# Идемпотентен. Требует R2-креды S3 API (см. этап 06 плейбука).
#
# Вход (env):
#   R2_BUCKET, R2_ENDPOINT                     бакет и S3-эндпоинт R2
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  R2-креды (S3 API)
#   RETENTION_DAYS                             срок хранения дампов (default: 35)
#   R2_LOCATION_HINT                           регион-подсказка (default: weur)
set -euo pipefail

: "${R2_BUCKET:?R2_BUCKET не задан}"
: "${R2_ENDPOINT:?R2_ENDPOINT не задан}"

export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

RETENTION_DAYS="${RETENTION_DAYS:-35}"
LOCATION="${R2_LOCATION_HINT:-weur}"

if aws s3api head-bucket --bucket "$R2_BUCKET" --endpoint-url "$R2_ENDPOINT" 2>/dev/null; then
  echo "Бакет $R2_BUCKET уже существует"
else
  aws s3api create-bucket --bucket "$R2_BUCKET" --endpoint-url "$R2_ENDPOINT" \
    --create-bucket-configuration "LocationConstraint=$LOCATION"
  echo "Бакет $R2_BUCKET создан (location hint: $LOCATION)"
fi

aws s3api put-bucket-lifecycle-configuration --bucket "$R2_BUCKET" \
  --endpoint-url "$R2_ENDPOINT" --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-old-dumps",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "Expiration": {"Days": '"$RETENTION_DAYS"'}
    }]
  }'
echo "Lifecycle: удаление объектов старше $RETENTION_DAYS дней"
