#!/usr/bin/env bash
# Вотчер issues для основной сессии — второй поток событий рядом с
# pr_watcher.sh (автопилот, CLAUDE.md): будит на НОВУЮ issue и на смену
# триаж-флагов существующих (auto / spec:ready / needs:owner). Гарантирует,
# что триаж и диспетчеризация автопилота не зависят от случайных пробуждений.
# Запуск и жизненный цикл — как у pr_watcher.sh: Bash run_in_background,
# выход на первом событии, перезапуск тем же ходом (#368).
#
# Закрытие issue — НЕ событие (#368): номер, пропавший из открытых, молча
# уходит из снимка. Закрывает issue почти всегда мерж PR с «Closes #N», а
# его уже доложил вотчер PR — второе пробуждение на тот же мерж было шумом.
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

# Событие = запись снимка, которой в прежнем нет целиком: новая issue или
# смена её флагов. Снимок пишется ДО печати и выхода — перезапущенный
# вотчер не повторит то же событие. Непрочитанный прежний снимок
# (испорчен, пуст) считает событием всё — лучше лишнее пробуждение, чем
# молча проглоченная issue.
while true; do
  if [ -n "$CUR" ] && [ "$CUR" != "$(cat "$STATE")" ]; then
    PREV=$(cat "$STATE")
    printf '%s' "$CUR" > "$STATE"
    FRESH=$(jq -cn --argjson p "$PREV" --argjson c "$CUR" \
      '[$c[] | select(. as $x | any($p[]; . == $x) | not)]' 2>/dev/null) || FRESH="$CUR"
    if [ "$FRESH" != "[]" ]; then
      echo "Issues изменились. БЫЛО: $(printf '%s' "$PREV" | jq -c . 2>/dev/null || printf '%s' "$PREV") СТАЛО: $(printf '%s' "$CUR" | jq -c .) НОВОЕ: $FRESH"
      exit 0
    fi
  fi
  sleep 120
  CUR=$(snap)
done
