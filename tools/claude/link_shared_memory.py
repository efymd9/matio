#!/usr/bin/env python3
"""SessionStart-хук Claude Code: общая авто-память всех инстансов.

Память проекта привязана к пути рабочей директории
(~/.claude/projects/<ключ-пути>/memory), поэтому сессия в worktree
стартует с пустой памятью. Хук заменяет её каталог симлинком на
канонический — память ОСНОВНОГО чекаута. Урок, записанный одним
инстансом, немедленно виден остальным.

Установка (этап 02 плейбука): подставить в MAIN_CHECKOUT абсолютный путь
основного чекаута репозитория. Ключ каталога памяти — путь с заменой
«/» на «-» (пример: /Users/alex/dev/myapp → -Users-alex-dev-myapp);
после первой сессии сверить фактическое имя в ~/.claude/projects/.

Свойства: самопочинка (любой новый worktree подключается первой же
сессией), непустые каталоги не перезатираются, любая ошибка — только
строка в stderr, сессия не страдает (exit 0 всегда). Путь хранилища
берём из transcript_path входного JSON — без угадывания правил
манглинга путей.
"""

import json
import sys
from pathlib import Path

MAIN_CHECKOUT = Path.home() / "dev" / "matio"  # основная (не голая) копия репозитория
CANONICAL = (
    Path.home()
    / ".claude/projects"
    / str(MAIN_CHECKOUT).replace("/", "-")
    / "memory"
)


def main() -> None:
    data = json.load(sys.stdin)
    transcript = data.get("transcript_path") or ""
    if not transcript:
        return
    # каталог проекта = предок транскрипта, лежащий прямо в projects/
    project_dir = Path(transcript).parent
    while project_dir.parent.name != "projects":
        if project_dir == project_dir.parent:
            return
        project_dir = project_dir.parent
    memory = project_dir / "memory"

    if memory.is_symlink():
        return  # уже подключена (или намеренно указывает в другое место)
    if memory.resolve() == CANONICAL.resolve():
        return  # основной чекаут — его память и есть каноническая
    if memory.is_dir() and any(memory.iterdir()):
        print(
            f"link_shared_memory: {memory} не пуст — не трогаю, "
            "слейте с канонической памятью вручную",
            file=sys.stderr,
        )
        return
    if memory.is_dir():
        memory.rmdir()
    CANONICAL.mkdir(parents=True, exist_ok=True)
    memory.symlink_to(CANONICAL)
    print(f"link_shared_memory: {memory} -> {CANONICAL}", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — хук не должен валить сессию
        print(f"link_shared_memory: {exc}", file=sys.stderr)
    sys.exit(0)
