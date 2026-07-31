# Этап 05 — Деплой: staging на Fly.io и релизы

## Что вы получите

Живой staging: каждый мерж в main автоматически деплоится на Fly.io
(миграции — release_command), `/healthz` отдаёт версию. Версионирование —
release-please: бот копит changelog из conventional commits в Release PR,
мерж которого (только по вашему «релизь») создаёт тег и GitHub Release.
Релизный ритуал — скилл.

## Что делает человек

1. Зарегистрируйтесь на fly.io, привяжите карту (без неё машины не
   создаются). Установите flyctl: `brew install flyctl` /
   `curl -L https://fly.io/install.sh | sh`; `fly auth login`.
2. Создайте deploy-токен ПОСЛЕ того, как агент создаст приложение (он
   скажет, когда): `fly tokens create deploy -a <app>`.
   ГРАБЛЯ (проверено кровью): часть вывода `fly tokens create` уходит в
   stderr — при перенаправлении в файл/переменную токен можно молча
   потерять; копируйте из терминала целиком, токен начинается с
   `FlyV1 `. Положите в секрет репо:
   `gh secret set FLY_API_TOKEN` (вставить значение).
3. Для release-please создайте GitHub App (Settings → Developer settings →
   GitHub Apps): permissions Contents: Read&Write + Pull requests:
   Read&Write, «Only on this account»; установите App на репозиторий;
   сгенерируйте private key. Секреты: `gh secret set RELEASE_PLEASE_APP_ID`
   и `gh secret set RELEASE_PLEASE_APP_PRIVATE_KEY < key.pem`.
   (Почему не GITHUB_TOKEN: PR, созданные GITHUB_TOKEN, не триггерят
   workflow — CI на Release PR не запустится, и ruleset его не пропустит.)
4. Прод-домен и prod-приложение на этом этапе НЕ нужны — staging живёт на
   бесплатном поддомене `<app>.fly.dev`.
5. Скормите промпт.

## Промпт для агента

```
Настрой деплой staging и релизный процесс по плейбуку docs/mega-process/
(этап 05). Хостинг — Fly.io (flyctl авторизован у владельца; создание
приложений и секретов — платные/внешние действия, каждое согласуй со мной
явно). Работай веткой + PR; конфиги — в репо.

1. Контейнеризация сервера (если нет): Dockerfile + fly.toml в каталоге
   сервера. В fly.toml: internal_port; [http_service] c auto_stop_machines
   = "stop", auto_start_machines = true, min_machines_running = 0
   (эконом-режим); release_command = команда миграций; ЯВНАЯ секция
   [http_service.concurrency] (дефолт fly-proxy — невидимый потолок
   соединений; задай type = "connections", soft/hard по здравому смыслу
   нашего стека). /healthz в приложении должен отдавать JSON со status и
   version (version — из env APP_VERSION).
2. Создание staging (по одному, показывая мне команды): fly apps create
   <project>-staging; Postgres — САМЫЙ дешёвый вариант (fly postgres
   create, 1 нода shared-cpu-1x; это unmanaged — бэкапы приедут на этапе
   06); fly secrets set DATABASE_URL=… и остальные секреты приложения
   (спроси у меня значения; НИКОГДА не вписывай секреты в файлы репо).
   Если нужен Redis/кеш — отдельное приложение ровно с ОДНОЙ машиной;
   ГРАБЛЯ: flyctl deploy по умолчанию --ha=true и молча создаёт ВТОРУЮ
   машину — для одиночного Redis это расщепление pub/sub и очередей;
   всегда деплой с --ha=false и добавь в deploy-workflow проверку
   «у Redis ровно одна машина».
3. Workflow deploy-staging (.github/workflows/deploy-staging.yml): push в
   main, concurrency без cancel-in-progress; guard-шаг «секрета
   FLY_API_TOKEN нет → notice и пропуск» (workflow не красный, пока
   staging не настроен); checkout с fetch-depth: 0 (теги для версии);
   деплой: VERSION=$(git describe --tags --always);
   flyctl deploy <серверный каталог> --remote-only --env
   APP_VERSION=${VERSION#v}.
4. release-please: файлы release-please-config.json (release-type simple,
   единая версия продукта, extra-files — файлы версий сервера и
   приложения) и .release-please-manifest.json; workflow
   .github/workflows/release-please.yml на push в main, токен — через
   actions/create-github-app-token из секретов RELEASE_PLEASE_APP_*.
   Конвенция коммитов (fix→patch, feat→minor, feat!→major) — в CLAUDE.md.
5. Скилл релиза: скопируй docs/mega-process/skills/release/SKILL.md в
   .claude/skills/release/SKILL.md, замени {{PROJECT}} и плейсхолдеры
   доменов на наши, вычеркни пункты про ещё не внедрённые модули
   (пометь их «после этапа NN»).
6. Скилл devops: скопируй ШАБЛОН docs/mega-process/skills/devops/SKILL.md
   в .claude/skills/devops/SKILL.md и заполни то, что УЖЕ существует
   (аккаунты, staging, где лежат токены). Правило живости — в CLAUDE.md:
   изменил инфраструктуру → обновил /devops тем же PR.
7. Проверка: мерж этого PR должен задеплоить staging; покажи мне
   зелёный прогон deploy-staging и вывод curl https://<app>.fly.dev/healthz
   (version совпадает с git describe). Затем дождись появления Release PR
   от бота и убедись, что CI на нём запустился.
```

## Критерии готовности

- [ ] Мерж в main → деплой staging автоматически; `/healthz` отдаёт
      версию, совпадающую с `git describe`.
- [ ] Миграции применяются release_command'ом (проверить логи деплоя).
- [ ] Release PR существует, обновляется после каждого мержа, CI на нём
      бежит; в его ветку никто не коммитит.
- [ ] «Релизь» → мерж Release PR → тег vX.Y.Z + GitHub Release + бамп
      версий файлов; staging после деплоя показывает новую версию.
- [ ] Скиллы /release и /devops установлены и отражают реальность.

## Бюджетные развилки

- **Эконом**: shared-cpu-1x 256–512MB + auto-stop (~$0–3/мес при штиле:
  спящие машины почти бесплатны), Postgres одной shared-нодой (~$2–4/мес),
  один staging без прода. Этого хватает до первых живых пользователей.
- **Как у оригинала**: правило «класс машин — минимум performance-1x,
  shared-cpu нигде, включая staging». ПОЧЕМУ: shared-vCPU — burstable,
  под постоянной нагрузкой (WebSocket-соединения, чаты) троттлится, и
  ёмкость «плывёт» от прогона к прогону — ни паспорт ёмкости, ни инциденты
  не воспроизводимы. Замер оригинала: одно выделенное ядро дало 800 пар
  соединений против 350 у двух shared-машин при сопоставимой цене.
  Триггер апгрейда: у вас появились постоянные соединения/фоновая нагрузка
  И вы начали что-то мерить (этап 09) — до этого shared-cpu честно
  экономит деньги. Performance-1x ≈ $30+/мес за машину. Вторая грабля
  оригинала: многоядерной машине обязателен запуск с несколькими
  воркерами (`uvicorn --workers N` и аналоги) — иначе лишние ядра
  простаивают, один процесс живёт на одном ядре.
- **Прод**: отдельное приложение + домен + свои секреты — заводите, когда
  есть кому им пользоваться; процесс не меняется (deploy-prod по тегу или
  вручную по «релизь»).
