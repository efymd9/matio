#!/usr/bin/env bash
# Канонический вотчер бебиситинга PR для worktree-агента (замкнутый
# PR-цикл, CLAUDE.md). Запускается инструментом Monitor с persistent: true —
# процесс живёт, пока PR открыт: каждое событие печатается строкой и будит
# агента; на MERGED/CLOSED печатает финал и завершается (конец наблюдения).
# Перевзвод после события НЕ нужен; после рестарта сессии страхует
# SessionStart-хук. Обработал событие — просто продолжай, вотчер уже дежурит.
#
# Будит на: красный чек CI · новый комментарий (тред PR или ревью) ·
# смену reviewDecision · конфликт с main · отставание ветки (BEHIND) ·
# MERGED/CLOSED. Зелёные завершения чеков сами по
# себе не будят: агенту там делать нечего, мерж — забота основной сессии.
#
# Конструктивные решения — те же, что у tools/claude/pr_watcher.sh
# (не упрощать!): снимок переживает перезапуски (сеем только если файла
# нет), первая проверка сразу, синглтон на ветку.
set -euo pipefail

BRANCH="${1:-$(git branch --show-current)}"
[ -n "$BRANCH" ] || { echo "detached HEAD — ветки нет, следить не за чем" >&2; exit 1; }
TOP=$(git rev-parse --show-toplevel)
KEY=$(printf '%s' "$TOP@$BRANCH" | shasum | cut -c1-12)
STATE="/tmp/pr_babysit_${KEY}.json"
PIDFILE="/tmp/pr_babysit_${KEY}.pid"

if [ -f "$PIDFILE" ]; then
  old=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "$old" ] && [ "$old" != "$$" ] && ps -p "$old" -o command= 2>/dev/null | grep -q 'pr_babysit'; then
    kill "$old" 2>/dev/null || true
  fi
fi
echo "$$" > "$PIDFILE"

# conflicting/behind: конфликт с main и отставание ветки не рождают ни
# коммитов, ни комментов — без этих полей агент узнаёт о них только от
# человека (проверено у оригинала: о конфликте агента будил комментарий
# основной сессии, сам он не видел). Оба состояния — работа агента:
# конфликт → разрешить (правило «пришедший вторым»), отстал →
# git merge origin/main и пуш.
# mergeable=UNKNOWN (пересчёт после пуша) намеренно НЕ событие.
FILTER='{state: .state,
  red: ([.statusCheckRollup[]? | select(.conclusion != null)
        | select((.conclusion | ascii_upcase) as $c
                 | ($c == "SUCCESS" or $c == "NEUTRAL" or $c == "SKIPPED") | not)
        | "\(.name):\(.conclusion)"] | sort),
  comments: (.comments | length),
  reviews: (.latestReviews | length),
  decision: .reviewDecision,
  conflicting: (.mergeable == "CONFLICTING"),
  behind: (.mergeStateStatus == "BEHIND")}'

snap() {
  gh pr view "$BRANCH" --json state,statusCheckRollup,comments,latestReviews,reviewDecision,mergeable,mergeStateStatus \
    --jq "$FILTER" 2>/dev/null || true
}

CUR=$(snap)
[ -n "$CUR" ] || { echo "PR для ветки $BRANCH не найден" >&2; exit 1; }
[ -f "$STATE" ] || printf '%s' "$CUR" > "$STATE"

while true; do
  if [ -n "$CUR" ]; then
    st=$(printf '%s' "$CUR" | jq -r .state)
    if [ "$st" != "OPEN" ]; then
      if [ "$st" = "MERGED" ]; then
        echo "PR ветки $BRANCH: MERGED — ритуал уборки (CLAUDE.md)"
      else
        echo "PR ветки $BRANCH: $st — разобраться, почему закрыт без мержа"
      fi
      printf '%s' "$CUR" > "$STATE"
      exit 0
    fi
    if [ "$CUR" != "$(cat "$STATE")" ]; then
      echo "Событие на PR ветки $BRANCH. БЫЛО: $(jq -c . < "$STATE") СТАЛО: $(printf '%s' "$CUR" | jq -c .)"
      printf '%s' "$CUR" > "$STATE"
    fi
  fi
  sleep 60
  CUR=$(snap)
done
