# Комплект скриптов мега-процесса

Полные рабочие копии боевых скриптов оригинального проекта, генерализованные
(owner/repo/ID — через конфиг, специфика вычищена). **Встроенные комментарии
с конструктивными решениями — часть канона**: у процесса есть правило
«решения задокументированы в скрипте — не переписывать по памяти», и эти
комментарии переезжают вместе со скриптами. Не упрощайте их.

| Файл | Куда ставится | Этап | Что делает |
|---|---|---|---|
| `board_status.sh` | `tools/claude/` + `board.env` рядом | 02 | статус задачи на доске Projects v2 (добавляет на доску, если нет) |
| `pr_babysit.sh` | `tools/claude/` | 02 | вотчер бебиситинга своего PR (worktree-агент) |
| `babysit_guard.sh` | `tools/claude/` | 02 | хук-гард: не даёт агенту бросить открытый PR |
| `link_shared_memory.py` | `tools/claude/` (заполнить `{{MAIN_CHECKOUT}}`) | 02 | общая авто-память всех инстансов через симлинк |
| `settings.worktree.json` | `.claude/settings.json` (коммитится) | 02 | хуки SessionStart/Stop для всех worktree |
| `gen_api.sh` | `tools/` (адаптировать под стек) | 03 | контрактный ритуал: OpenAPI → клиент |
| `qa/mobile_coverage.py` | `tools/qa/` (адаптировать под стек) | 03 | покрытие без генерённого + порог-рэтчет |
| `backup/backup_db.sh` | `infra/backup/` | 06 | дамп БД → age → R2 |
| `backup/restore_check.sh` | `infra/backup/` | 06 | ежемесячная проба восстановления |
| `backup/setup_r2.sh` | `infra/backup/` | 06 | одноразовая настройка бакета + retention |
| `pr_watcher.sh` | `tools/claude/` | 08 | вотчер очереди PR (основная сессия) |
| `issue_watcher.sh` | `tools/claude/` | 08 | вотчер issues/триаж-флагов (основная сессия) |
| `watcher_guard.sh` | `tools/claude/` | 08 | хук-гард вотчеров основной сессии |
| `settings.local.main.json` | `.claude/settings.local.json` основного чекаута (НЕ коммитится) | 08 | хуки гарда основной сессии |
| `wt_janitor.py` | `tools/claude/` | 08 | уборщик worktree: удаляет только доказанное «всё влито» |

Зависимости: `gh` (авторизованный, со скоупом `project`), `jq`, `git`;
для бэкапов — `aws` CLI, `age`, `pg_dump`/`pg_restore` мажора сервера.
