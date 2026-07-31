#!/usr/bin/env bash
# Вотчер очереди PR для основной сессии (замкнутый PR-цикл, CLAUDE.md).
# Запускается инструментом Monitor c persistent: true — процесс живёт всю
# сессию, НЕ завершается на событии: каждое изменение очереди печатается
# строками БЫЛО/СТАЛО, и каждая печать будит сессию уведомлением.
# Перевзвод после события НЕ нужен; нужен только после рестарта сессии
# (страхует SessionStart-хук). Гасить — TaskStop.
#
# Конструктивные решения (не упрощать — каждое оплачено потерянным событием):
# - Снимок /tmp/pr_queue_state.json ПЕРЕЖИВАЕТ перезапуски: сеем только
#   если файла нет — иначе события из слепой зоны между смертью старого
#   вотчера и стартом нового теряются молча (проверено кровью у оригинала:
#   упавший вотчер + пересев снимка = молча пропущенный merge-конфликт).
# - Первая проверка — сразу при старте, до первого sleep (та же грабля).
# - Release-please PR игнорируется: он обновляется после каждого мержа
#   в main и иначе даёт ложное пробуждение на каждый релизный апдейт.
# - Синглтон: новый экземпляр вытесняет прежний — в том числе запущенный
#   «мимо харнесса» через `&` (такой процесс не может будить сессию).
#   Некролог exit 143 у вытесненного экземпляра — штатный, не ошибка.
#   При Monitor-схеме перевзводы редки (только после рестарта сессии),
#   поэтому некрологи вытеснения практически исчезают.
set -euo pipefail

PIDFILE=/tmp/pr_watcher.pid
if [ -f "$PIDFILE" ]; then
  old=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "$old" ] && [ "$old" != "$$" ] && ps -p "$old" -o command= 2>/dev/null | grep -q 'pr_watcher'; then
    kill "$old" 2>/dev/null || true
  fi
fi
echo "$$" > "$PIDFILE"

STATE=/tmp/pr_queue_state.json
# behind: PR отстал от main (ruleset требует актуальности) — зелёный CI при
# этом НЕ рождает изменений очереди, и без этого поля вотчер молчит, пока
# PR застрял (слепая зона, пойманная владельцем у оригинала: авто-мерж ждал
# update-branch, а сессию ничто не будило).
FILTER='[.[] | select((.isDraft|not) and (.headRefName | startswith("release-please--") | not)) | {n:.number, oid:.headRefOid, behind:(.mergeStateStatus=="BEHIND")}] | sort_by(.n)'

[ -f "$STATE" ] || gh pr list --state open --json number,headRefOid,isDraft,headRefName,mergeStateStatus --jq "$FILTER" > "$STATE"

while true; do
  CUR=$(gh pr list --state open --json number,headRefOid,isDraft,headRefName,mergeStateStatus --jq "$FILTER" 2>/dev/null || true)
  if [ -n "$CUR" ] && [ "$CUR" != "$(cat "$STATE")" ]; then
    echo "Очередь PR изменилась. БЫЛО: $(jq -c '.' < "$STATE") СТАЛО: $(echo "$CUR" | jq -c '.')"
    echo "$CUR" > "$STATE"
  fi
  sleep 60
done
