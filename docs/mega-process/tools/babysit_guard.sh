#!/usr/bin/env bash
# Механическая страховка бебиситинга PR для WORKTREE-агентов (замкнутый
# PR-цикл, CLAUDE.md). Подключён хуками в закоммиченном .claude/settings.json
# и потому приезжает в каждый worktree автоматически — не зависит от
# памяти агента. В основном чекауте молчит: там свой гард
# (tools/claude/watcher_guard.sh в settings.local.json).
#
# Режимы:
#   session-start — у текущей ветки есть открытый PR, а вотчер бебиситинга
#     мёртв → впрыснуть в контекст инструкцию взвести его.
#   stop — то же условие → ЗАБЛОКИРОВАТЬ завершение хода: «сделал PR и
#     ушёл» физически невозможно. stop_hook_active гасит петлю.
#
# Клапан осознанной паузы (агент ждёт ответа владельца): файл-маркер
# .claude/babysit-paused в корне worktree — пока он есть, гард молчит.
set -euo pipefail
mode="${1:-}"

TOP=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$TOP/.git" ] || exit 0            # .git-каталог = основной чекаут, не наш клиент
[ ! -f "$TOP/.claude/babysit-paused" ] || exit 0

BRANCH=$(git branch --show-current 2>/dev/null || true)
[ -n "$BRANCH" ] || exit 0              # detached HEAD — цикл завершён, ветки нет

pr_state=$(gh pr view "$BRANCH" --json state --jq .state 2>/dev/null || true)
[ "$pr_state" = "OPEN" ] || exit 0      # PR нет или уже закрыт — следить не за чем

KEY=$(printf '%s' "$TOP@$BRANCH" | shasum | cut -c1-12)
PIDFILE="/tmp/pr_babysit_${KEY}.pid"
if [ -f "$PIDFILE" ]; then
  pid=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -q 'pr_babysit'; then
    exit 0                              # вотчер жив — всё в порядке
  fi
fi

case "$mode" in
  session-start)
    echo "У ветки $BRANCH ОТКРЫТЫЙ PR, а вотчер бебиситинга не запущен. Взведи его инструментом Monitor: command='bash tools/claude/pr_babysit.sh', persistent=true (description='бебиситинг PR'). Monitor не в списке инструментов — сначала ToolSearch select:Monitor. НЕ через Bash run_in_background и НЕ через '&'. Осознанная пауза (ждёшь ответа владельца) — создай файл .claude/babysit-paused."
    ;;
  stop)
    input=$(cat)
    active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)
    if [ "$active" != "true" ]; then
      jq -n --arg b "$BRANCH" '{decision: "block",
        reason: ("У ветки " + $b + " открытый PR, а вотчер бебиситинга мёртв — бросать PR нельзя (CLAUDE.md, замкнутый PR-цикл). До завершения хода взведи вотчер инструментом Monitor: command=bash tools/claude/pr_babysit.sh, persistent=true (Monitor не в списке — ToolSearch select:Monitor). Если пауза осознанная — ждёшь ответа владельца — создай файл .claude/babysit-paused и завершай ход.")}'
    fi
    ;;
  *)
    echo "usage: babysit_guard.sh session-start|stop" >&2
    exit 1
    ;;
esac
