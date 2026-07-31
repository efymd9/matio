#!/usr/bin/env bash
# ШАБЛОН контрактного ритуала: перегенерация клиента приложения из
# OpenAPI-спеки сервера. Паттерн: «изменил контракт → экспортировал спеку
# из кода → перегенерировал клиент → закоммитил всё одним PR».
# Генерённый клиент НИКОГДА не правится руками — только перегенерация
# (и при merge-конфликте в генерённом — тоже перегенерация, не ручной мерж).
#
# Замените генератор под свой стек:
#   Flutter:      openapi-generator -g dart-dio (пример ниже)
#   React Native: npx openapi-typescript / orval / openapi-generator -g typescript-fetch
#   Kotlin:       openapi-generator -g kotlin
#   Swift:        openapi-generator -g swift5
# Экспорт спеки из кода сервера тоже подстройте: FastAPI отдаёт
# app.openapi(), Express — swagger-jsdoc, Spring — springdoc и т.п.
#
# Запуск из корня репо: ./tools/gen_api.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Экспорт OpenAPI из кода сервера"
# ЗАМЕНИТЕ на команду своего сервера; важно, чтобы спека генерировалась
# ИЗ КОДА (единственный источник правды), а не велась руками параллельно.
(cd server && uv run python -m app.cli export-openapi --output openapi.json)

echo "==> Генерация клиента приложения"
rm -rf app/packages/api_client
openapi-generator generate \
  -i server/openapi.json \
  -g dart-dio \
  -o app/packages/api_client \
  --additional-properties=pubName=api_client,legacyDiscriminatorBehavior=false \
  >/dev/null

echo "==> Пост-генерация (кодоген сериализаторов и т.п. — если нужен вашему стеку)"
(cd app/packages/api_client && flutter pub get >/dev/null && dart run build_runner build --delete-conflicting-outputs >/dev/null)

echo "==> Готово: app/packages/api_client"
