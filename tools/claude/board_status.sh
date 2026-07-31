#!/usr/bin/env bash
# Смена статуса задачи на доске (GitHub Projects v2).
# Использование: tools/claude/board_status.sh <номер-issue> <статус>
# Статусы: backlog (продуктовый) | tech (технический) | spec | progress | review | done
# Правило выбора бэклога: лейбл auto / чистый техдолг без участия владельца → tech;
# идеи, продуктовые задачи, всё ждущее его решения → backlog.
#
# Конфигурация — файл board.env рядом со скриптом (создаётся при установке,
# этап 02 плейбука). ID проекта/поля/опций добываются GraphQL-запросом:
#   gh api graphql -f query='query{ user(login:"<owner>"){ projectV2(number:<N>){
#     id fields(first:20){ nodes{ ... on ProjectV2SingleSelectField{
#       id name options{ id name } } } } } }'
# (для организации — organization(login:...) вместо user).
#
# ВНИМАНИЕ (проверено кровью у оригинала): ID опций перегенерируются ВСЕ при
# любом updateProjectV2Field — однажды смена набора опций молча обнулила
# статусы всей доски. Меняешь колонки → снимок ВСЕЙ доски до, восстановление
# после, новые ID в board.env.
set -euo pipefail

CONF="$(cd "$(dirname "$0")" && pwd)/board.env"
[ -f "$CONF" ] || { echo "нет $CONF — создай его при установке (этап 02 плейбука)" >&2; exit 1; }
# board.env задаёт: BOARD_OWNER, BOARD_NUMBER, PROJECT_ID, FIELD_ID,
# OPT_BACKLOG, OPT_TECH, OPT_SPEC, OPT_PROGRESS, OPT_REVIEW, OPT_DONE
# shellcheck source=/dev/null
. "$CONF"
: "${BOARD_OWNER:?board.env: BOARD_OWNER не задан}"
: "${BOARD_NUMBER:?board.env: BOARD_NUMBER не задан}"
: "${PROJECT_ID:?board.env: PROJECT_ID не задан}"
: "${FIELD_ID:?board.env: FIELD_ID не задан}"

ISSUE="${1:?использование: board_status.sh <номер-issue> <статус>}"
STATUS="${2:?статусы: backlog | tech | spec | progress | review | done}"

case "$STATUS" in
  backlog)  OPT="${OPT_BACKLOG:?}" ;;   # Продуктовый бэклог
  tech)     OPT="${OPT_TECH:?}" ;;      # Технический бэклог
  spec)     OPT="${OPT_SPEC:?}" ;;
  progress) OPT="${OPT_PROGRESS:?}" ;;
  review)   OPT="${OPT_REVIEW:?}" ;;
  done)     OPT="${OPT_DONE:?}" ;;
  *) echo "неизвестный статус: $STATUS (backlog|tech|spec|progress|review|done)" >&2; exit 1 ;;
esac

ITEM=$(gh project item-list "$BOARD_NUMBER" --owner "$BOARD_OWNER" --format json --limit 200 \
  | jq -r ".items[] | select(.content.number == $ISSUE) | .id")

if [ -z "$ITEM" ]; then
  # задачи нет на доске — добавляем (новые issue попадают сюда впервые;
  # `gh issue create` элемент в Project НЕ добавляет — это и есть причина,
  # почему пара «create + board_status» обязательна)
  URL=$(gh issue view "$ISSUE" --json url --jq .url)
  ITEM=$(gh project item-add "$BOARD_NUMBER" --owner "$BOARD_OWNER" --url "$URL" --format json | jq -r .id)
fi

gh project item-edit --id "$ITEM" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ID" --single-select-option-id "$OPT" >/dev/null
echo "#$ISSUE → $STATUS"
