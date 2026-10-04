#!/usr/bin/env bash
# Механическая страховка вотчеров ОСНОВНОЙ сессии (очередь PR + issues).
# Подключается хуками из .claude/settings.local.json основного чекаута —
# файл gitignored и не копируется в worktree, поэтому на агентов не действует
# (дополнительная защита: main_checkout проверяет, что .git — каталог,
# а не файл-ссылка worktree).
#
# Режимы:
#   session-start — хук SessionStart: если вотчер не жив, впрыснуть в
#     контекст сессии инструкцию взвести его. Молчит, когда всё в порядке.
#   stop — хук Stop: если вотчер мёртв, ЗАБЛОКИРОВАТЬ завершение хода и
#     потребовать перевзвести. stop_hook_active страхует от бесконечной
#     петли: повторный стоп подряд не блокируем.
#
# Клапан простоя (#404): файл .claude/watchers-paused в основном чекауте.
# Харнесс ограничивает жизнь фоновой задачи ~2 ч (timeout 7200000 — предел)
# и на пределе просит НЕ перезапускать её. Поэтому в простое (нет агентов,
# PR, задач в работе) вотчер, снятый на пределе, не перезапускают, а кладут
# флаг: пока он есть, гард молчит, а session-start напоминает одной строкой.
# Появилась работа — флаг удалить, вотчеры запустить.
set -euo pipefail
mode="${1:-}"

alive() { pgrep -f 'tools/claude/pr_watcher\.sh' >/dev/null 2>&1; }
issues_alive() { pgrep -f 'tools/claude/issue_watcher\.sh' >/dev/null 2>&1; }
main_checkout() {
  local top
  top=$(git rev-parse --show-toplevel 2>/dev/null) && [ -d "$top/.git" ]
}
paused() {
  local top
  top=$(git rev-parse --show-toplevel 2>/dev/null) && [ -f "$top/.claude/watchers-paused" ]
}

case "$mode" in
  session-start)
    if main_checkout && paused; then
      echo "Вотчеры основной сессии на паузе (.claude/watchers-paused, простой). Как только появится работа — удали флаг и запусти оба вотчера Bash-инструментом с run_in_background=true и timeout=7200000: bash tools/claude/pr_watcher.sh и bash tools/claude/issue_watcher.sh."
    elif main_checkout; then
      if ! alive; then
        echo "PR watcher НЕ запущен. Запусти его Bash-инструментом с run_in_background=true и timeout=7200000: command='bash tools/claude/pr_watcher.sh' (description='очередь PR'). Вотчер выходит на первом событии, а харнесс снимает его по таймауту (предел ~2 ч) — пока идёт работа, запусти снова; в простое на пределе не перезапускай, а положи флаг .claude/watchers-paused. НЕ через Monitor (истекает каждые 30 минут и будит впустую) и НЕ через '&' (процесс мимо харнесса не будит)."
      fi
      if ! issues_alive; then
        echo "Issue watcher НЕ запущен (триаж и диспетчеризация автопилота зависят от него). Запусти Bash-инструментом с run_in_background=true и timeout=7200000: command='bash tools/claude/issue_watcher.sh' (description='issues/автопилот'); после события — снова; в простое на пределе — флаг .claude/watchers-paused."
      fi
    fi
    ;;
  stop)
    input=$(cat)
    active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)
    if [ "$active" != "true" ] && main_checkout && ! paused && { ! alive || ! issues_alive; }; then
      jq -n '{decision: "block", reason: "Мёртв вотчер основной сессии (очередь PR и/или issues) — вотчер выходит после каждого события и снимается харнессом по таймауту, запусти недостающий до завершения хода Bash-инструментом с run_in_background=true и timeout=7200000: bash tools/claude/pr_watcher.sh и/или bash tools/claude/issue_watcher.sh. НЕ через Monitor и НЕ через &. После запуска ход можно завершать. Простой и вотчер снят на пределе (~2 ч) — вместо запуска положи флаг .claude/watchers-paused."}'
    fi
    ;;
  *)
    echo "usage: watcher_guard.sh session-start|stop" >&2
    exit 1
    ;;
esac
