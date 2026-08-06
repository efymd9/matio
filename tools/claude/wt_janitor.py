#!/usr/bin/env python3
"""Уборщик осиротевших worktree (запускает основная сессия после мержей).

Удаляет worktree и его локальную ветку ТОЛЬКО когда механически доказано,
что терять нечего:
  1) рабочая копия чиста (нет незакоммиченного/неотслеживаемого);
  2) по ветке существует ВЛИТЫЙ PR;
  3) tip локальной ветки — предок head'а влитого PR (всё локальное вошло
     в то, что было влито; squash скрывает это от git merge-base с main,
     поэтому сверяемся с refs/pull/<n>/head, а не с main).
Заблокированные worktree (живая сессия) пропускаются, если не задан
--include-locked. Без --yes только показывает план (dry-run).
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def run(*cmd: str, cwd: str | None = None) -> str:
    return subprocess.run(
        cmd, capture_output=True, text=True, check=True, cwd=cwd
    ).stdout.strip()


def worktrees(repo: str) -> list[dict]:
    items, cur = [], {}
    for line in run("git", "worktree", "list", "--porcelain", cwd=repo).splitlines():
        if not line:
            if cur:
                items.append(cur)
            cur = {}
        elif line.startswith("worktree "):
            cur = {"path": line.split(" ", 1)[1], "locked": False}
        elif line.startswith("branch "):
            cur["branch"] = line.split("refs/heads/", 1)[-1]
        elif line == "locked" or line.startswith("locked "):
            cur["locked"] = True
    if cur:
        items.append(cur)
    return items


def merged_pr(branch: str) -> dict | None:
    out = run(
        "gh", "pr", "list", "--head", branch, "--state", "merged",
        "--json", "number,headRefOid", "--limit", "1",
    )
    prs = json.loads(out)
    return prs[0] if prs else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="удалять (без флага — dry-run)")
    ap.add_argument("--include-locked", action="store_true",
                    help="проверять и заблокированные (сессия могла умереть, оставив lock)")
    args = ap.parse_args()

    repo = run("git", "rev-parse", "--path-format=absolute", "--git-common-dir")
    repo = str(Path(repo).parent)

    removed = kept = 0
    for wt in worktrees(repo):
        path, branch = wt["path"], wt.get("branch")
        if path == repo or not branch:
            continue
        tag = f"{path} [{branch}]"

        if wt["locked"] and not args.include_locked:
            print(f"ПРОПУСК {tag}: заперт (возможно, живая сессия)")
            kept += 1
            continue
        if run("git", "status", "--porcelain", cwd=path):
            print(f"ПРОПУСК {tag}: есть незакоммиченное")
            kept += 1
            continue
        pr = merged_pr(branch)
        if not pr:
            print(f"ПРОПУСК {tag}: влитого PR по ветке не нашёл")
            kept += 1
            continue
        # tip ветки должен быть внутри влитого PR
        tmp_ref = f"refs/janitor/pr-{pr['number']}"
        run("git", "fetch", "origin", f"refs/pull/{pr['number']}/head:{tmp_ref}",
            cwd=repo)
        tip = run("git", "rev-parse", branch, cwd=repo)
        try:
            subprocess.run(
                ["git", "merge-base", "--is-ancestor", tip, pr["headRefOid"]],
                check=True, cwd=repo, capture_output=True,
            )
        except subprocess.CalledProcessError:
            print(f"ПРОПУСК {tag}: tip не входит в влитый PR #{pr['number']} — есть невлитое")
            kept += 1
            continue
        finally:
            run("git", "update-ref", "-d", tmp_ref, cwd=repo)

        if not args.yes:
            print(f"УДАЛИЛ БЫ {tag}: чист, целиком в PR #{pr['number']} (dry-run)")
            continue
        if wt["locked"]:
            run("git", "worktree", "unlock", path, cwd=repo)
        run("git", "worktree", "remove", path, cwd=repo)
        run("git", "branch", "-D", branch, cwd=repo)
        print(f"УДАЛЁН {tag}: содержимое целиком в PR #{pr['number']}")
        removed += 1

    print(f"\nитого: удалено {removed}, оставлено {kept}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
