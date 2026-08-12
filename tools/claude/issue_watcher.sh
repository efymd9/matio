#!/usr/bin/env bash
# Вотчер issues для основной сессии — второй поток событий рядом с
# pr_watcher.sh (автопилот, CLAUDE.md): будит на НОВУЮ issue и на смену
# триаж-флагов существующих (auto / spec:ready / needs:owner / закрытие).
# Запускается инструментом Monitor (persistent: true); каждое событие —
# строка в stdout. Гарантирует, что триаж и диспетчеризация автопилота
# не зависят от случайных пробуждений.
#
# Конструктивные решения — как у pr_watcher.sh (не упрощать!):
# снимок переживает перезапуски (сеем только если файла нет), первая
# проверка сразу, синглтон через pidfile (некролог exit 143 при
# вытеснении — штатный).
set -euo pipefail

PIDFILE=/tmp/issue_watcher.pid
if [ -f "$PIDFILE" ]; then
  old=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "$old" ] && [ "$old" != "$$" ] && ps -p "$old" -o command= 2>/dev/null | grep -q 'issue_watcher'; then
    kill "$old" 2>/dev/null || true
  fi
fi
echo "$$" > "$PIDFILE"

STATE=/tmp/issue_queue_state.json
FILTER='[.[] | {n: .number,
  auto: ([.labels[].name] | contains(["auto"])),
  spec: ([.labels[].name] | contains(["spec:ready"])),
  owner: ([.labels[].name] | contains(["needs:owner"]))}] | sort_by(.n)'

snap() {
  gh issue list --state open --limit 200 --json number,labels --jq "$FILTER" 2>/dev/null || true
}

CUR=$(snap)
[ -f "$STATE" ] || printf '%s' "$CUR" > "$STATE"

while true; do
  if [ -n "$CUR" ] && [ "$CUR" != "$(cat "$STATE")" ]; then
    echo "Issues изменились. БЫЛО: $(jq -c . < "$STATE") СТАЛО: $(printf '%s' "$CUR" | jq -c .)"
    printf '%s' "$CUR" > "$STATE"
  fi
  sleep 120
  CUR=$(snap)
done
