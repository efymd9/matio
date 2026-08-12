# Ранбук: восстановление базы из бэкапа

Читается в инциденте, поэтому здесь только шаги и команды. Как устроены сами
бэкапы — в скилле `/devops` (раздел «Бэкапы») и в шапках `infra/backup/*.sh`.

## Сначала выбери путь

| Что случилось | Чем чинить |
|---|---|
| «Удалил не те строки десять минут назад» | **Neon PITR**: ветка от точки во времени в панели Neon. Быстрее и точнее этого ранбука; наши дампы — суточной давности |
| Базы нет: удалён проект/ветка Neon, вендор потерял данные, шифровальщик | **Этот ранбук.** Дампы лежат ВНЕ Neon (Vercel Blob), это единственная копия, до которой авария не дотянулась |
| «А бэкапы вообще живые?» | Не гадать: `gh workflow run db-restore-check` — это и есть автоматическая проба, она делает всё описанное ниже сама |

Потеря данных за окно между дампами (**до 24 часов**) — принятый риск этой
схемы, а не дефект.

## Что понадобится

- **Приватный age-ключ** — у владельца в менеджере паролей, он же в секрете
  репозитория `BACKUP_AGE_SECRET_KEY`. Без него дампы не расшифровать НИКОГДА:
  вторых копий ключа не существует;
- **`BLOB_READ_WRITE_TOKEN`** — токен стора `matio-blob` (Vercel → Storage →
  matio-blob, он же в `.env.local`). Объекты приватные, по голому URL не
  отдаются;
- **клиенты Postgres 18** — тот же мажор, что сервер. Младший мажор дамп не
  прочитает: `brew install postgresql@18`, бинарники в
  `/opt/homebrew/opt/postgresql@18/bin` (keg-only, PATH подставить руками);
- `age` (`brew install age`), `node` + `pnpm` в чекауте репозитория.

Проверить доступ к хранилищу, ничего не восстанавливая (запись → чтение →
удаление служебного объекта):

```bash
pnpm exec tsx infra/backup/blob.ts selftest db-backups/production/
# OK: раунд-трип к хранилищу прошёл (db-backups/production/selftest-….bin)
```

## 1. Найти последний дамп

```bash
export BLOB_READ_WRITE_TOKEN=…            # значение не печатать и не коммитить
pnpm exec tsx infra/backup/blob.ts latest db-backups/production/
# db-backups/production/db-20260805T034012Z.dump.age  2026-08-05T03:40:31.000Z  4193280
```

Три поля: ключ, время заливки, размер. Время заливки — первое, на что смотреть:
дамп старше суток означает, что `db-backup` стоит, и восстанавливать придётся
из того, что есть.

## 2. Скачать и расшифровать

```bash
KEY=db-backups/production/db-20260805T034012Z.dump.age
pnpm exec tsx infra/backup/blob.ts fetch "$KEY" /tmp/db.dump.age
age -d -i ~/matio-age.key -o /tmp/db.dump /tmp/db.dump.age
```

Расшифрованный файл — это почта живых аккаунтов и история просмотров.
Не класть его в репозиторий, не прикладывать к issue, удалить сразу после
восстановления (`rm -f /tmp/db.dump /tmp/db.dump.age`).

## 3. Поднять чистую цель

**Никогда не восстанавливать поверх живой базы.** Восстановление поверх
существующих таблиц ляжет наполовину, и в итоге не будет ни старых данных, ни
новых.

- в Neon: **Create branch** от `production` → в новой ветке
  `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` (или просто новая база в
  той же ветке);
- локально: `createdb -p 5432 matio_restore`.

Строка подключения дальше — `$RESTORE_URL`. Проверить, что цель пуста:

```bash
psql "$RESTORE_URL" -tAc "select count(*) from pg_tables where schemaname='public'"   # 0
```

## 4. Восстановить

```bash
export PATH=/opt/homebrew/opt/postgresql@18/bin:$PATH
pg_restore --version                       # обязан быть 18.x
pg_restore --no-owner --no-privileges --exit-on-error \
  --dbname="$RESTORE_URL" /tmp/db.dump
```

Если `pg_restore` упал на `CREATE EXTENSION` (расширение есть у Neon, но нет в
целевой базе) — вырезать записи расширений через TOC-фильтр, как это делает
проба:

```bash
pg_restore -l /tmp/db.dump > /tmp/db.toc
grep -vE '^[0-9]+; [0-9]+ [0-9]+ (EXTENSION |COMMENT - EXTENSION )' /tmp/db.toc > /tmp/db.toc.keep
pg_restore --no-owner --no-privileges --exit-on-error \
  --use-list=/tmp/db.toc.keep --dbname="$RESTORE_URL" /tmp/db.dump
```

## 5. Проверить, что восстановилось

Те же smoke-запросы, что гоняет `infra/backup/restore_check.sh`:

```bash
psql "$RESTORE_URL" -tAc "select count(*) from drizzle.__drizzle_migrations"   # голова миграций
psql "$RESTORE_URL" -tAc "select count(*) from pg_tables where schemaname='public'"
psql "$RESTORE_URL" -tAc "select count(*) from shows"
psql "$RESTORE_URL" -tAc "select count(*) from episodes"
psql "$RESTORE_URL" -tAc "select count(*) from users"
```

Число миграций обязано совпасть с количеством файлов в `drizzle/*.sql` на том
коммите, что сейчас в проде. Меньше — значит дамп снят до последних миграций, и
после переключения надо прогнать `pnpm db:migrate`.

## 6. Переключить приложение

1. Neon: сделать восстановленную ветку основной (или скопировать в неё
   строку подключения) и обновить `DATABASE_URL` в проекте Vercel —
   **во всех окружениях, где он задан**;
2. редеплой (переменные окружения связываются на этапе деплоя, не в рантайме);
3. `curl -s https://matio.tv/api/healthz | jq` — `status: ok`;
4. глазами: главная отдаёт каталог, `/watch/<slug>` играет, вход в аккаунт
   работает;
5. Stripe/Clerk/Mux трогать не нужно — их состояние живёт у вендоров, наша
   база лишь зеркало. Расхождения по подпискам вычинит ближайший вебхук.

## 7. После восстановления — обязательные хвосты

- **GDPR**: восстановление возвращает и то, что было удалено по запросу
  пользователя. Прогнать удаление ЗАНОВО по всем заявкам, исполненным между
  датой дампа и моментом восстановления, иначе персональные данные воскресли
  без основания;
- **письма-напоминания**: строки `show_reminders` вернулись в состояние на
  момент дампа — отписки, сделанные позже, придётся исполнить повторно
  (`lib/email-unsubscribe.ts`);
- снять внеплановый дамп сразу после переключения:
  `gh workflow run db-backup`;
- завести issue с разбором инцидента (`type:bug`, `domain:infra`) и положить
  её на доску.

## Чего в бэкапе НЕТ

Дамп — это только Postgres. **Артворк шоу в Vercel Blob и видео в Mux не
бэкапятся**: файлы лежат у вендоров, в базе — только ссылки на них. Потеря
стора Blob означает потерю постеров при живом каталоге; потеря аккаунта Mux —
потерю видео. Это осознанный предел этапа 06, строка в `docs/registry.md`.
