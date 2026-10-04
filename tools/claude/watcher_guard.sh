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
set -euo pipefail
mode="${1:-}"

alive() { pgrep -f 'tools/claude/pr_watcher\.sh' >/dev/null 2>&1; }
issues_alive() { pgrep -f 'tools/claude/issue_watcher\.sh' >/dev/null 2>&1; }
main_checkout() {
  local top
  top=$(git rev-parse --show-toplevel 2>/dev/null) && [ -d "$top/.git" ]
}

case "$mode" in
  session-start)
    if main_checkout; then
      if ! alive; then
        echo "PR watcher НЕ запущен. Запусти его Bash-инструментом с run_in_background=true и timeout=43200000: command='bash tools/claude/pr_watcher.sh' (description='очередь PR'). Вотчер выходит на первом событии, а в простое его снимает харнесс по таймауту (с 43200000 — раз в 12 ч) — в обоих случаях запусти снова. НЕ через Monitor (истекает каждые 30 минут и будит впустую) и НЕ через '&' (процесс мимо харнесса не будит)."
      fi
      if ! issues_alive; then
        echo "Issue watcher НЕ запущен (триаж и диспетчеризация автопилота зависят от него). Запусти Bash-инструментом с run_in_background=true и timeout=43200000: command='bash tools/claude/issue_watcher.sh' (description='issues/автопилот'); после события или снятия по таймауту — снова."
      fi
    fi
    ;;
  stop)
    input=$(cat)
    active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)
    if [ "$active" != "true" ] && main_checkout && { ! alive || ! issues_alive; }; then
      jq -n '{decision: "block", reason: "Мёртв вотчер основной сессии (очередь PR и/или issues) — вотчер выходит после каждого события и снимается харнессом по таймауту, запусти недостающий до завершения хода Bash-инструментом с run_in_background=true и timeout=43200000: bash tools/claude/pr_watcher.sh и/или bash tools/claude/issue_watcher.sh. НЕ через Monitor и НЕ через &. После запуска ход можно завершать."}'
    fi
    ;;
  *)
    echo "usage: watcher_guard.sh session-start|stop" >&2
    exit 1
    ;;
esac
