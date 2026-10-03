# Карта персональных данных Matio

Снята ПО ФАКТУ кодовой базы 06.09.2026 (`db/schema/*`, `lib/*`, `proxy.ts`,
`app/api/**`, `infra/backup/*`, `mobile/src/**`). Обновляется ТЕМ ЖЕ PR, что
меняет обработку данных (правило в CLAUDE.md). Имена — реальные имена таблиц
и колонок; если чего-то нет в схеме, его нет и здесь.

Обозначения: **PII** — прямо идентифицирует (email); **псевдо** — идентифицирует
только вместе с чем-то ещё (UUID cookie, Clerk id, HMAC IP); **агрегат** — не
о человеке.

## 1. Где физически живут данные

| Хранилище | Регион | Что лежит | Ретеншен (факт) |
|---|---|---|---|
| **Neon Postgres**, проект `little-base-06482402`, ветка production | AWS eu-central-1 (Франкфурт) | все таблицы из §2 | по окнам §2: ежедневный крон `/api/cron/retention` (`lib/retention.ts`, Vercel Cron 04:10 UTC, политики = обещания `/privacy` §6) удаляет батчами `trial_sessions` (30 дн., анонимные), `visitors`+`visitor_days` (25 мес.), `watch_days` (25 мес.), отправленные `show_reminders` (30 дн. после отправки), `idea_submissions` (24 мес. от `created_at`, #297); остальное — с аккаунтом; PITR 6 ч |
| Neon, ветка staging | тот же регион | только сид-данные (нет аккаунтов, истории, адресов — реестр) | — |
| **Vercel Blob** `matio-blob` (public store) | Франкфурт | (а) артворк шоу + аватары виртуальных актёров — не персональное; (б) `db-backups/production/db-<UTC>.dump.age` — полный дамп базы, зашифрован age (публичный ключ в GH vars; приватный — менеджер паролей владельца + секрет `BACKUP_AGE_SECRET_KEY`), объект приватный | (б) 35 дней + самый свежий дамп всегда остаётся (`infra/backup/retention.ts`) |
| **GitHub Actions**, раннер `ubuntu-latest` | США, эфемерный | `db-backup`: дамп в открытом виде во временном каталоге до шифрования (минуты, `trap rm`); `db-restore-check` (1-го числа): полное восстановление в открытом виде в контейнере Postgres 18 на время джобы; артефактов нет, наружу — одна строка со счётчиками | жизнь джобы |
| **Vercel Functions** (`fra1`) + Edge Middleware (`proxy.ts`, глобально) | Франкфурт / edge | запрос в полёте: cookies, IP (сырой IP читается из `x-vercel-forwarded-for` и сразу хешируется — не сам адрес, а его бакет `lib/ip-bucket.ts`: IPv4 по адресу, IPv6 по /64, #351; `x-vercel-ip-country` → страна), UA; runtime-логи — `console.warn/error` с id/статусами (лог-аудит `lib/log-audit.test.ts`) | логи: Hobby 1 ч / Pro 1 сутки (план — уточнить, `/privacy` обещает 30 дней) |
| Vercel Data Cache / память процесса | fra1 | `unstable_cache` `catalog` (шоу, нет PII); агрегаты PostHog/Mux Data (числа); `roleCache` в `proxy.ts` — `userId → role`, 5 с | TTL 5 с … 1 ч |
| **Clerk** (prod-инстанс, `clerk.matio.tv`) | США (GCP + Cloudflare по DPA; регион не раскрыт) | идентичность: email, пароль (хеш) или email-код, сессии (IP, UA, устройство), имя если задано, OAuth-профили | пока существует аккаунт (удаление — источник истины) |
| **Stripe** (Stripe Payments Europe Ltd) | Ирландия + US-аффилиаты | Customer (email, billing name/address), способ оплаты (токен), инвойсы, Subscription с `metadata` (см. §3) | по правилам Stripe; инвойсы — налоговые записи (6–10 лет) |
| **Mux** | США | видеоассеты (контент, не персональное); CDN-логи доставки (IP/UA зрителя на каждом сегменте — инфраструктура Mux); Mux Data (по согласию): cookie viewer-id, QoE, watch time | по правилам Mux |
| **Resend** | США (отправка из eu-west-1) | адрес получателя, тема, тело письма (название шоу/эпизода, логлайн, подписанный URL кадра), события доставки | логи 30 дней (Free/Pro/Scale) |
| **PostHog Cloud EU** | Франкфурт | события с `distinct_id` (анонимный uuid → Clerk id после `identify`), свойства персоны `{email}`, супер-свойства `locale`/`locale_source`, session replay (все input/text замаскированы), `$ip`/geo, referrer/utm; с posthog-js 1.433 (#242) — также Meta `_fbc`/`_fbp` из кук пикселя: `$fbc` и `$fbp` как свойства персоны; `$fbc` может быть выведен из `?fbclid` в URL и без куки пикселя. Реплей пишет и **консольные логи браузера** (`capture_console_log_opt_in: true` — настройка проекта 190233, маска input/text на консоль не действует; сверено 27.09.2026 — отсюда запрет `console.*` в `components/ideas/`, #297); тела и заголовки сетевых запросов **не** пишет (`session_recording_network_payload_capture_config: null`, сверено 27.09.2026) | по плану PostHog (уточнить); при стирании аккаунта person по `distinct_id` = Clerk id удаляется вместе с событиями И записями сессий (`delete_events=true&delete_recordings=true`, `lib/posthog-erase.ts`, best-effort, #180) |
| **Meta** (Pixel + CAPI) | Ирландия / США | браузерные события с `_fbp`/`_fbc`, IP/UA запроса; CAPI `Purchase` с SHA-256 email, SHA-256 Clerk id, `_fbp`, `_fbc`, сырой IP, UA | по правилам Meta |
| **Google** (GA4) | Ирландия / США | `page_view` и события gtag, client id `_ga`; user_id/email кодом не передаются | настройка ретеншена событий в свойстве GA4 (2 или 14 мес. — уточнить) |
| **OpenAI** (ChatGPT Ads pixel `oaiq`) | Ирландия / США | `page_viewed`, `registration_completed`/`subscription_created` с `event_id` = `signup:<Clerk id>` или Stripe subscription id, `plan_id`, `amount`, `currency`; cookie `__oppref` (click id), IP/UA запроса | по правилам OpenAI |
| **Sentry** (org-регион EU) | ЕС | ошибки/трейсы: `user.id` (Clerk id) и только он, URL без query — в `request.url`, `transaction`, данных breadcrumbs и спанов И в атрибутах корневого спана `contexts.trace.data` (до #346 там уходили `http.target` с query — у ссылки отписки это base64 адреса — и `url.full`/`url.query` спанов fetch), UA, `content-type`/`content-length`; без cookies, тел, breadcrumbs консоли, replay, feedback. **Приложение (#317)** — тот же проект, только в сборке с `EXPO_PUBLIC_SENTRY_DSN` (без DSN SDK не загружается вовсе): JS-ошибки (падения рендера из границ #308, необработанные исключения и rejection) после тех же скрабберов `lib/observability.ts`; нативные крэши iOS/Android — отчётом нативного SDK, МИМО JS-скрабберов: стек, контекст устройства (модель, ОС, память, локаль; имени устройства нет — `sendDefaultPii:false`), breadcrumbs (JS — уже вычищенные, синхронизируются в native; сетевые нативные выключены — несли query), `user.id` = случайный installation id SDK (не Clerk id: приложение пользователя не задаёт); release `matio-app@<версия>+<сборка>`; только ошибки и крэши — без release-health сессий (`enableAutoSessionTracking:false`: иначе installation id уходил бы с каждого запуска каждого устройства), replay, feedback, скриншотов, иерархии вида, трейсинга | ошибки 30/90 дней по плану |
| **Устройство — браузер** | у пользователя | cookies (таблица в §4), `localStorage`-флаги дедупа событий (`matio:fb:lead`, `matio:fb:creg:<Clerk id>`, `matio:ph:signup:<Clerk id>`, `matio:oaiq:signup:<Clerk id>`, `matio:oaiq:purchase:<sub id>`), настройки media-chrome (mute) | до очистки браузера |
| **Устройство — приложение (Expo)** | у пользователя | `expo-secure-store`: Clerk session JWT; `matio_device_id` — UUID (аналог `matio_aid`; минтится при первом запросе к `/v1` и уходит заголовком `X-Matio-Device-Id` в КАЖДОМ запросе, `mobile/src/api/client.ts`; **iOS keychain может пережить удаление приложения** — поведение ОС, код при переустановке его не чистит; на Android обычно удаляется вместе с приложением); оба — класс keychain `AFTER_FIRST_UNLOCK` (#299, `mobile/src/keychain.ts`; id, выпущенный старой сборкой, сохраняет класс, с которым был записан); `matio_locale` — выбранный язык (`es`/`en`, предпочтение, не идентификатор; #96); `matio_autoplay_next` — переключатель автоплея (`1`/`0`, предпочтение; #245). Язык и автоплей на сервер не уходят (кроме `locale` при регистрации в Clerk — §3). `/privacy` §11 (#312) описывает ровно это. Только в памяти процесса (не на диске): очередь неотправленных 10-секундных бакетов просмотра — `episode_id` + номера бакетов, без позиции и без идентификатора (`mobile/src/watch/segment-queue.ts`, #97) | SecureStore — до удаления/сброса; очередь — до закрытия приложения; Sentry (только с DSN, #317): нативный SDK держит на диске installation id (случайный UUID) и до 30 неотправленных конвертов ошибок (офлайн-кеш) — до отправки |
| **Машина оператора** (ответ на запрос субъекта, #163) | у оператора | `export-<Clerk id>-<дата>.json` от `pnpm export-user-data` — полная запись ОДНОГО человека (девять таблиц §2 + профиль Clerk, Customer/инвойсы Stripe, персона/события PostHog), права `0600`; при отправке — зашифрованный архив (`age -p`) | до отправки ответа, затем удалить (`docs/runbooks/gdpr-requests.md` §3, шаг 5); в репозиторий, issue и чат агента не попадает |

## 2. Таблицы по чувствительности

**Чувствительных (ст. 9) колонок — нет.** Все персональные данные — обычные.
Оговорка с #297: свободный текст идей (`idea_submissions.logline` / `story` /
`working_title`) может СЛУЧАЙНО нести данные особых категорий и данные
третьих лиц — форма просит «Fiction only… leave out real people's names and
private details», но исключить этого не может (переоценка DPIA — юристу,
`docs/registry.md`).
Ниже — каждая таблица схемы с персональными полями, ключ стирания и ретеншен.

### Обычные персональные данные

| Таблица | Персональные поля | Класс | Как стирается | Ретеншен |
|---|---|---|---|---|
| `users` | `id` (Clerk id), `email`, `role`, `stripe_customer_id`, `signup_origin`, `country`, `attribution_{first,last}_{source,medium,campaign}`, `created_at` | PII | корень каскада: вебхук Clerk `user.deleted` → `lib/erase-user.ts:eraseUser` → `DELETE FROM users` (идемпотентно; тот же `eraseUser` руками — `pnpm erase-user <id> --apply`, #180). Самообслуживание — «Delete account» во вкладке «Аккаунт» приложения (#309): `POST /api/v1/account/delete` (только Bearer) зовёт тот же `eraseUser` сам, СНАЧАЛА, и только после него удаляет аккаунт в Clerk (`users.deleteUser`; 404 = уже удалён) — от подписки вебхука на `user.deleted` этот путь не зависит, а пришедший вебхук находит строку уже стёртой (идемпотентный `not_found`). Сбой стирания — 500, аккаунт в Clerk цел, повтор сходится; сбой Clerk после стирания — 500, повтор дожимает Clerk. После ответа Clerk — и при не-404 сбое тоже (таймаут не доказывает, что аккаунт жив) — ещё один взгляд на `users`: строку, которую в окне между двумя половинами мог вернуть heal `/v1/progress` (#303, `getOrSyncCurrentUser` читает ещё живой Clerk), стирает тот же `eraseUser`; сбой этого шага — лог + Sentry по id, `pnpm erase-user <id> --apply`. До DELETE: живая подписка Stripe получает `cancel_at_period_end: true` (best-effort, лог + Sentry по id), а в `erased_customers` (см. ниже) пишутся `stripe_customer_id` И все `cus_…`, которые `customers.search` находит по адресу аккаунта (#223). После DELETE: PostHog person по Clerk id + события (best-effort, `lib/posthog-erase.ts`). Остаток аккаунта, удалённого в Clerk без стирания (#172), стирает тот же `eraseUser` при конфликте адреса (#380, `lib/user-mirror.ts`): вебхук `user.created` или `getOrSyncCurrentUser` нового аккаунта с тем же адресом спрашивает Clerk о Clerk id строки, держащей адрес — 404 → `eraseUser(<тот id>)` как ПОЗДНЕЕ стирание (`addressReassignedAt` = создание нового аккаунта: без поиска клиентов Stripe по адресу, `show_reminders` / `idea_submissions` по адресу — только созданные до нового аккаунта; остаток — `docs/registry.md`) и повтор вставки; аккаунт жив с другим адресом → его строка получает текущий основной адрес из Clerk; жив и адрес его / ошибка Clerk — ничего не трогается (лог + Sentry по id) | пока есть аккаунт |
| `erased_customers` | `stripe_customer_id`, `erased_at` | псевдо (только id клиента Stripe — ни адреса, ни Clerk id; без FK — строка `users` уже стёрта). Источник id при стирании: `users.stripe_customer_id` **плюс** все клиенты, которых `customers.search({ query: "email:'<адрес>'" })` находит по адресу аккаунта (#223 — гостевой checkout создаёт Customer из адреса на форме, поздняя покупка из-под аккаунта перезаписывает id в `users`, старого помнит только Stripe); поиск best-effort, одна страница ≤100, ДО `DELETE FROM users` (последний момент, когда адрес есть) и ТОЛЬКО при платёжном следе — `stripe_customer_id` или строка `subscriptions` (иначе `skipped_no_stripe_footprint`: адрес аккаунта эпохи free/gate в Stripe не уходит); из ответа тумбстоунятся только клиенты с ТОЧНО этим адресом (у Stripe `:` по строковому полю — «все слова по порядку», `a@b.com` вернул бы и `a@b.com.mx`), остальные пропускаются и только считаются; сбой — лог + Sentry по id, ручной путь в ранбуке §4 | **не стирается — это тумбстоун**: `claimGuestCheckout` (единственный путь, создающий аккаунт из клиента Stripe) не запускается для id из этой таблицы — иначе следующий вебхук Stripe по клиенту (`guest = "1"` в метаданных подписки не истекает) воскресил бы Clerk-пользователя и `users` с адресом. Проверяется в `mirrorSubscription` (ветка «нет пользователя») и на `/welcome` (`lib/guest-checkout.ts:isErasedCustomer`) | бессрочно — «не воскрешать» не имеет срока: Stripe хранит клиента как налоговую запись годами, и его вебхуки могут прийти через годы. Ст. 17(3)(b)/(e)-образное основание: минимальная запись, нужная, чтобы стирание было необратимым |
| `subscriptions` | `user_id` → CASCADE, `stripe_subscription_id`, `status`, `plan`, `current_period_end`, `cancel_at_period_end`, `attribution_*`, `created_at`/`updated_at` | псевдо | каскад с `users` | с аккаунтом; налоговые записи — у Stripe, не здесь |
| `watch_progress` | `user_id` → CASCADE, `episode_id`, `position_seconds`, `max_position_seconds`, `total_watched_seconds`, `completed`, `first_watched_at`, `updated_at` | псевдо (история просмотра) | каскад с `users` | с аккаунтом |
| `watch_days` | `user_id` → CASCADE, `day` | псевдо | каскад с `users`; крон ретеншена | **25 месяцев** по `day` (крон, `lib/retention.ts`; окно «Audience-measurement data» `/privacy` §6 — вошедшая половина той же метрики: WAU/new/returning/lost; самый длинный диапазон дашборда — 366 дней) |
| `trial_sessions` | `session_token` (UUID cookie `trial_session` **или** `matio_device_id` приложения), `show_id`, `started_at`/`expires_at`, `user_id` → SET NULL, `converted`, `last_position_seconds`, `ip_hash` (HMAC-SHA256 IP, соль = `MUX_SIGNING_KEY_PRIVATE_KEY`), `client` (`web` — cookie / `app` — device id, #349; NULL у строк до колонки; не персональное, флаг источника), `attribution_*`, `kind`, `furthest_episode_number`, `last_episode_id`, `signup_wall_at` | псевдо | крон ретеншена (анонимные строки); при удалении аккаунта строка теряет `user_id` (SET NULL) и попадает под крон следующим прогоном | **30 дней** по `started_at` для строк без `user_id` (`/privacy` §6 «Trial sessions … 30 days»); строки с `user_id` — данные аккаунта, живут с ним («Account: while your account exists») и уезжают ≤30 дней после стирания. Строки приложения (device UUID) — те же анонимные строки; после удаления на следующем воспроизведении минтится свежая. Строки приложения к аккаунту не привязываются ничем: в `/api/v1` связывания нет (у вошедшего на free-эпизоде и на 60-с превью строка минтится тоже, без `user_id`), и с #349 их не привязывает и веб. `lib/trial.ts:linkTrialSessionsToCurrentUser` (рендер `/subscribe` и tier-gated `/watch` вошедшим) связывает по cookie (точное совпадение токена) и IP-фолбэком — непривязанные строки с тем же `ip_hash` за 6 ч (`LINK_IP_WINDOW_MS`), но ТОЛЬКО с `client='web'`: строка устройства (`client='app'`) и строка без записанного `client` (до колонки) в фолбэк не попадают — за CGNAT оператора чужой телефон иначе оказался бы в аккаунте. Различить клиентов по `session_token` нельзя: и cookie веба (`crypto.randomUUID()`), и device id (`Crypto.randomUUID()`) — канонический UUID v4, поэтому колонка (миграция 0028, expand-only). Привязанная ранее строка (cookie веба; IP-фолбэк до #349) выпадает из крона (`isNull(user_id)`), живёт с аккаунтом и входит в выгрузку ст. 15; при удалении аккаунта — SET NULL и снова крон (≤30 дней от создания). Непривязанные удаление аккаунта не трогает. Строки устройств, привязанные в проде ДО #349, и абзац `/privacy` §11 (#312), который ещё описывает прежнее поведение, — решения владельца (оба в `docs/registry.md`) |
| `visitors` | `aid` (UUID cookie `matio_aid`), `first_seen_at`, `first_path`, `referrer` (сырой `document.referrer`, ≤300 символов — может нести чужие query-параметры), `utm_*`, `country`, `user_id` → SET NULL, `linked_at` | псевдо | крон ретеншена; при удалении аккаунта остаётся без `user_id` до своего окна | **25 месяцев** по `first_seen_at` (`/privacy` §6 «Audience-measurement data … up to 25 months»), независимо от `user_id` — источник/страна регистрации уже проштампованы в `users` |
| `visitor_days` | `aid` → CASCADE от `visitors`, `day`, `landed_home`, `show_viewed`, `wall_seen` | псевдо | каскад с `visitors` | как `visitors` — день не может быть раньше `first_seen_at`, так что каскад забирает всё |
| `show_reminders` | `email`, `show_id`, `user_id` → SET NULL, `locale`, `ip_hash`, `created_at`, `notified_at` | PII | `unsubscribeEmail` (все строки адреса, `lib/email-unsubscribe.ts`) и удаление аккаунта: `user.deleted` удаляет все строки по адресу аккаунта + по `user_id` до каскада (анонимные строки с другим адресом не затрагиваются — их стирает отписка или, по заявке, `pnpm erase-email <адрес> --apply`, #339; экспорт по адресу без аккаунта — `pnpm export-email`, `user_id` чужого аккаунта в файл не попадает, ст. 15(4)); отправленные — крон ретеншена | ожидающие (`notified_at IS NULL`) — до отправки или отписки; **отправленные — 30 дней после `notified_at`** (крон; `/privacy` §6 напоминания не называет — взят самый короткий срок политики, совпадает с 30-дневным логом доставки Resend; пометка юристу в реестре). Индекса по `notified_at` нет — подзапрос крона идёт seq-scan с `LIMIT`, что при десятках строк дешевле миграции; порог: выше ~10⁴ строк — частичный индекс `WHERE notified_at IS NOT NULL` одной миграцией (существующий `show_reminders_show_id_pending_idx` — обратная популяция, крону не служит) |
| `idea_submissions` | `email` (после trim + lowercase), `author_name` (имя или псевдоним для титров), `logline`, `story` (≤10 000 кодовых точек), `working_title`, `kind` (`continuation` / `new_series`), `show_id` → SET NULL (FK на `shows`, не на людей), `locale`, `terms_version` (версия Idea Submission Terms и текстов галочек), `marketing_opt_in` (галочка 3), `content_hash` (SHA-256 нормализованного текста — вместе с `email` ключ дедупа), `attribution_{first,last}_{source,medium,campaign}`, `created_at` | PII + свободный текст пользователя (оговорка выше). Запись с анонимной формы `/ideas` (#297, `app/(public)/ideas/actions.ts:submitIdea`) — аккаунт не нужен. **Нет** `user_id`, `ip_hash`, страны, отдельных флагов «18+» / «принял условия», времени согласия: IP нужен лимиту только на час и живёт в счётчике (строка ниже), согласие = сам факт строки + `terms_version` + `created_at` (прецедент #214; `ON CONFLICT DO NOTHING` не переписывает `marketing_opt_in`). Атрибуция на строке — чтобы видеть, какая кампания приводит авторов идей, которые студия развивает (число отправок этого не показывает — для него `idea_submitted` в PostHog, §3); без маркетингового согласия колонки NULL | (а) `eraseUser` по адресу аккаунта (`lib/erase-user.ts`, lowercase, шаг ДО `DELETE FROM users`, пока адрес читается) — у всех трёх вызывающих: вебхук Clerk `user.deleted`, `pnpm erase-user --apply`, «Delete account» в приложении (`/api/v1/account/delete`, #309); **FK на `users` нет намеренно** — карта FK в `app/api/webhooks/clerk/route.test.ts` этот шаг не ловит, его пришпиливают последовательности удалений в `lib/erase-user.test.ts`, `app/api/webhooks/clerk/route.test.ts` и `app/api/v1/account/delete/route.test.ts`; (б) по письму на contact@ — адрес БЕЗ аккаунта стирает `pnpm erase-email <адрес> --apply` (#339: обе таблицы по адресу одной транзакцией, dry-run по умолчанию; адрес с аккаунтом отклоняется с id аккаунта — ему `erase-user`; ранбук `gdpr-requests.md` §2; id — в реестр заявок), карточка `/admin/ideas/<id>` остаётся для одной строки; (в) крон ретеншена. Отписка (`unsubscribeEmail`) строки НЕ удаляет — ставит `marketing_opt_in = false` по адресу. **`marketing_opt_in = true` — не пригодное согласие**: адрес никто не подтверждал (любой может ввести чужой email и отметить галочку 3); первой маркетинговой рассылке обязано предшествовать письмо-подтверждение (double opt-in), и маркетинг получает только подтверждённый адрес (ст. 7(1) GDPR, PECR; `docs/registry.md`, строка «Story ideas send no email»). Экспорт ст. 15/20 — девятая таблица `pnpm export-user-data` (по адресу аккаунта, lowercase); у адреса без аккаунта — `pnpm export-email <адрес>` (#339: `show_reminders` и `idea_submissions` по адресу в нижнем регистре, файл `0600`, ранбук §2). Бэкапы `db-backup` держат удалённые строки до 35 дней; повторное стирание после восстановления — `docs/runbooks/db-restore.md` §7 (по id из реестра заявок) | **24 месяца** от `created_at` для КАЖДОЙ строки (крон, `lib/retention.ts`; `/privacy` §6 «Story ideas: up to 24 months from submission, or longer only if we develop your idea with you») — исключения для «выбранных» идей в v1 нет: «дольше» пока не на чем держать (`selected_at` нет; `docs/registry.md`, вопрос юристу про ст. 17(3)(e)). Стирание аккаунта удаляет и идеи с выданной лицензией |
| `guest_checkout_attempts` | `ip_hash` (ключ бакета: HMAC-SHA256 IP гостя **или** `user:` + HMAC-SHA256 Clerk id аккаунта, #227 — **или** `idea:` + HMAC-SHA256 IP автора идеи, #297, 10/ч, `IDEA_RATELIMIT_PER_HOUR` — та же соль `MUX_SIGNING_KEY_PRIVATE_KEY`, `lib/trial.ts:hashClientIp`; хешируется бакет IP, а не адрес: IPv6 — по /64, потому что адрес внутри своей сети клиент меняет сам (`lib/ip-bucket.ts`, #351; общий для всех лимитеров по IP); ни сырого IP, ни id, ни адреса — имя колонки историческое), `window_start`, `count` | псевдо (счётчик частоты создания Checkout Session: гость — 30/ч на IP, аккаунт — 10/ч, `AUTH_CHECKOUT_RATELIMIT_PER_HOUR`) | самопрунинг строк старше 2 ч (`lib/checkout-rate-limit.ts`); к аккаунту не привязывается никаким ключом, который мы держим — в экспорт ст. 15/20 не входит, каскада со стиранием нет (строка сама истекает раньше, чем стирание успевает понадобиться) | 2 ч |
| `guest_checkout_sessions` | `claim_token_hash` (HMAC-SHA256 значения cookie `checkout_claim`, соль = `MUX_SIGNING_KEY_PRIVATE_KEY` — само значение не хранится: по нему `/welcome` минтит sign-in ticket), `session_id` (id Checkout Session Stripe), `created_at` | псевдо (технический ключ гостевого sweep'а «одна открытая сессия», #224; ни e-mail, ни Clerk id — у гостя их ещё нет) | самопрунинг строк старше 24 ч на 5 % вызовов (`lib/guest-checkout-sessions.ts`); в экспорт ст. 15/20 не входит — к человеку не привязывается никаким ключом, который мы держим | 24 ч (срок жизни самой Checkout Session у Stripe) |
| `marketing_links` | `created_by` → SET NULL (id админа) | внутреннее | SET NULL | бессрочно (админские ссылки) |

### Не персональные (для полноты схемы)

`shows`, `seasons`, `episodes`, `actors` (виртуальные, вымышленные),
`show_actors` — контент. `watch_segments` — счётчики по (эпизод, день,
10-секундный бакет), агрегат; с #97 их пишет и приложение через
`POST /api/v1/watch-segments` (Bearer или `matio_device_id`; анонимный
вызов засчитывается только при наличии строки `trial_sessions` устройства
на это шоу и в пределах позиционного гейта) — тот же агрегат, никаких новых
полей; для вошедшего тот же вызов прибавляет `watch_progress.total_watched_seconds`
(псевдо, каскад с `users`, см. выше). `stripe_events` — id событий Stripe для
`show_actors` — контент. `episode_choices` (#143, ветвящееся видео) — рёбра
графа развилок между эпизодами: `from/to_episode_id`, `position`,
`label_en/es`, `is_default` — контент, вводится админом; выбор ЗРИТЕЛЯ на
развилке нигде отдельно не пишется — он материализуется как обычная строка
`watch_progress` (или `trial_sessions.last_episode_id`) на эпизоде-ветке,
то есть в уже существующем классе «история просмотра» с тем же каскадом
от `users`. Новые колонки `episodes.branch_of_episode_id` /
`fork_prompt_en/es` / `fork_window_seconds` — тоже контент.
`watch_segments` — счётчики по (эпизод, день,
10-секундный бакет), агрегат — крон ретеншена его не трогает (не о человеке;
кривая удержания старого эпизода читается по всем дням). `stripe_events` — id
событий Stripe для идемпотентности, растёт бессрочно: намеренно вне #162
(персональных данных нет; окно — отдельное решение, строка в
`docs/registry.md`).

## 3. Что уходит во внешние сервисы — дословно какие поля

**В LLM — ничего.** LLM-вызовов над данными пользователей в коде нет.
Инструменты разработки (Claude Code, Neon MCP) имеют доступ к проду — правило
в скилле: персональные колонки в контекст агента не выгружаются.

| Куда | Когда | Что именно (поля) | Гейт |
|---|---|---|---|
| **Clerk** | регистрация/вход; `claimGuestCheckout` | всё, что вводит пользователь в Clerk UI; приложение (своя форма, `mobile/src/components/sign-in-form.tsx`): `signIn.emailCode.sendCode({emailAddress})`, при новом адресе `signUp.create({emailAddress, locale})` (#304 — язык приложения) + код из письма; сервер: `users.createUser({emailAddress:[email], skipPasswordRequirement:true})`, `signInTokens.createSignInToken` (id) | договор |
| **Stripe** | `createAuthCheckoutSession` / `createGuestCheckoutSession` | `customers.create({email, metadata:{userId}})`; Checkout Session `locale`, `client_reference_id` (claim token); `subscription_data.metadata`: `userId`, `attr_first_*`/`attr_last_*` (UTM), `capi_consent`, `capi_ip` (сырой IP), `capi_ua`, `capi_fbp`, `capi_fbc` — **только до `Purchase`**: сразу после события `mirrorSubscription` стирает четыре сигнала (`subscriptions.update`, пустая строка = удаление ключа; best-effort, следующий вебхук с теми же ключами повторяет; `capi_consent` остаётся — флаг, не данные), `ph_consent`, `guest`, `claim_token`, `trial_token`, **`tos_version`** (только кошелёк на paywall, #210/#214 — см. ниже; метки времени нет); billing address и карта — вводятся у Stripe | договор; `capi_*` и `ph_*` — только при маркетинговом согласии; подписки до #165 и те, чьи события ушли в ранний выход зеркала (нет локального юзера / неизвестная цена), чистит `pnpm stripe:scrub-capi` (явный `STRIPE_SECRET_KEY`, dry-run по умолчанию) |
| **Clerk** (зеркало, #380) | конфликт адреса при записи строки `users` (вебхук `user.created` / `getOrSyncCurrentUser`, `lib/user-mirror.ts`) | `users.getUser(<Clerk id>)` строки, держащей адрес, — только id; адреса из ответа сравниваются в памяти и не логируются; ошибка в лог — статус и класс, не текст | договор; при 404 — ст. 17 (стирание остатка) |
| **Clerk** (стирание, #309) | «Delete account» в приложении → `POST /api/v1/account/delete` — ПОСЛЕ локального стирания | `users.deleteUser(<Clerk id>)` — только id (аккаунт, сессии и всё, что Clerk держит об идентичности, удаляет сам Clerk); 404 = уже удалён; ошибка в лог — статус и класс, не текст | ст. 17 — исполнение запроса |
| **Stripe** (стирание) | вебхук Clerk `user.deleted` / `pnpm erase-user --apply` / `POST /api/v1/account/delete` (#309) / конфликт адреса в `users` (#380) | `subscriptions.update(<sub id>, {cancel_at_period_end: true})` — только id подписки, ничего о пользователе; Customer не удаляется (`customers.del` — решение владельца, `docs/registry.md`) | ст. 17 — исполнение запроса |
| **PostHog** (стирание, `lib/posthog-erase.ts`) | вебхук Clerk `user.deleted` / `pnpm erase-user --apply` / `POST /api/v1/account/delete` (#309) / конфликт адреса в `users` (#380) — ПОСЛЕ локальных DELETE | `GET persons/?distinct_id=<Clerk id>` → `DELETE persons/{id}/?delete_events=true&delete_recordings=true` — стираются персона (с `email`), её события и записи сессий (replay в проекте включён); наружу уходит только id; тело ответа не читается и не логируется; 401/403 (нет `person:write`) → `skipped_forbidden`, таймаут/5xx → `failed` — оба в лог + Sentry по id, ручной путь в ранбуке §4 | ст. 17 — исполнение запроса |
| **Meta CAPI** (`lib/meta-capi.ts`) | вебхук Stripe, переход в access-granting | `Purchase`: `em` = SHA-256(email), `external_id` = SHA-256(Clerk id), `fbp`, `fbc`, `client_ip_address` (сырой), `client_user_agent`, `event_id` = sub id, `value`/`currency`, `content_ids` | `capi_consent` из метаданных |
| **Meta Pixel** (браузер) | по странице | `PageView`, `ViewContent`, `Lead`, `InitiateCheckout`, `CompleteRegistration`, `SubmitApplication {content_category: "story_idea"}` (успешная отправка идеи на `/ideas`, #297 — только из клиента, без email/имени/текстов; не `Lead` и без CAPI) + `_fbp`/`_fbc`, IP/UA запроса — самим пикселем. **Automatic Advanced Matching: не сверено** — `meta-pixel.tsx` делает голый `fbq('init', id)`; если AAM включён в Events Manager, пиксель сам читает поля email/имени на странице (`/ideas`, форма напоминаний) и шлёт их хеши в обход гейтов кода. Сверяет владелец для каждого ID из `NEXT_PUBLIC_META_PIXEL_ID` + `NEXT_PUBLIC_META_PIXEL_IDS`; до ответа — `docs/registry.md` (строка AAM / GA4, #297) → #341, реклама на `/ideas` заблокирована | `cookie_consent.marketing` |
| **PostHog** (браузер) | по странице | `$pageview`, `show_viewed`, `trial_play_started`, `signup_wall_shown`, `signup_completed`, `checkout_started`, `idea_submitted {idea_kind, show_slug}` (#297 — только при успешной отправке, `show_slug` только у продолжения; ни email, ни имени, ни текстов, ни их длин), … со свойствами `show_slug`, `episode_number`, `mode`, `auth`, `gate`; супер-свойства `locale`, `locale_source`; `identify(userId, {email})` после входа; session replay с маской всех input/text; UTM нормализуются в `before_send`; с posthog-js 1.433 (#242) SDK читает куки Meta `_fbc` (время клика по рекламе) и `_fbp` → свойства персоны `$fbc` и `$fbp` (`$set` по обоим каналам; `$fbc` SDK может синтезировать из `?fbclid` в URL и без куки пикселя — `fb.1.<ts>.<fbclid>`) — те же куки, что пишет пиксель, под тем же согласием | `cookie_consent.marketing` |
| **PostHog** (сервер, `lib/posthog-server.ts`) | вебхук Stripe | `subscribe_succeeded`: `distinctId` = Clerk id, `value`, `currency`, `plan`, `utm_*` first-touch | `ph_consent` из метаданных |
| **Google GA4** | по странице | `page_view` + события `trackGA` (без user_id/email в коде), Consent Mode v2. **«User-provided data collection → automatic detection»: не сверено** — если включено, gtag сам ищет email на странице (`/ideas`, форма напоминаний); сверяет владелец (GA4 Admin → Data collection), до ответа — `docs/registry.md` (строка AAM / GA4, #297) → #341 | `cookie_consent.marketing` |
| **OpenAI oaiq** | по странице; регистрация; возврат с оплаты | `page_viewed{type:contents}`; `registration_completed{type:customer_action}` или `subscription_created{plan_id, amount, currency}`; `options.event_id` = `signup:<Clerk id>` / Stripe sub id; cookie `__oppref` — самим SDK | `cookie_consent.marketing` |
| **Resend** | кнопка «Episode reminders» в админке | `to` = `show_reminders.email`, `subject`/`html`/`text` (название шоу, сезон/эпизод, логлайн, жанр, длительность, подписанный thumbnail-URL Mux с TTL 90 дней), `List-Unsubscribe` (HMAC адреса), `replyTo` contact@, idempotency-key = хеш id строк | явный запрос пользователя в форме |
| **Mux** | воспроизведение | JWT `aud: v` (playback id, exp ≤ 1 ч) — без PII; thumbnail JWT `aud: t`; Mux Data beacons (`player_name`, `video_series`) — только при согласии; Mux Data API — чтение агрегатов | договор; Data — согласие |
| **Sentry** | ошибка | событие после `scrubSentryEvent`: `user.id` только, URL без query/credentials — ключи `url`, `http.url`, `url.full`, `http.target`, `to`, `from` чистятся, отдельные `http.query`/`http.fragment`/`url.query`/`url.fragment` удаляются — в данных breadcrumbs, спанов и корневого спана `contexts.trace.data` (#317, #343, #346), заголовки по allowlist, email-подобные строки → `[redacted-email]`, у значения исключения / сообщения / брэдкрамба отрезан хвост `\nparams:` ошибки Drizzle — параметры упавшего запроса (cookie триала, device UUID, хэш IP; #326) | всегда (DSN задан) |
| **Sentry** (приложение, `mobile/src/observability.ts`, #317) | падение рендера, пойманное границей маршрута (`CrashScreen` → `captureCrash`); необработанное JS-исключение/rejection; нативный крэш | JS-событие — после тех же `beforeSend`/`beforeBreadcrumb` (`sentryPrivacyOptions()` через `mobile/src/shared/observability.ts`): сообщение и значение исключения с `[redacted-email]`, breadcrumbs без консоли и без query, `user` → только id; + контекст устройства, `environment` (`EXPO_PUBLIC_APP_ENV` → production), `release` `matio-app@<версия>+<сборка>`, `dist` = сборка. Нативный крэш — стек + контекст устройства + уже вычищенные breadcrumbs, installation id SDK. Только ошибки и крэши: сессий release health нет (`enableAutoSessionTracking:false`). Ни Clerk id, ни адреса, ни экрана | сборка с `EXPO_PUBLIC_SENTRY_DSN` (EAS env, production) |
| **Vercel** | каждый запрос | edge видит IP (нами не сохраняется), cookies, UA; runtime-логи — id/статусы | инфраструктура |
| **GitHub Actions** | ночной бэкап; ежемесячная проба | полный дамп (см. §1) | инфраструктура |

**Согласие на поверхности кошелька (#210, исправлено в #214).** Apple Pay /
Google Pay прямо на paywall создают Checkout Session с `ui_mode: 'elements'`,
а Stripe на этом ui_mode согласие не рендерит: `custom_text` отбивается
(`400 … not supported with ui_mode: elements`, проверено на живом API), а
единственный рендерер `consent_collection` — `TermsElement` — закрыт бетой.
Поэтому один обязательный чекбокс показываем мы сами
(`components/watch/wallet-express-checkout.tsx`, ключ `subscribe.walletConsent`
на языке зрителя): **принятие Условий** (ссылка на /terms) **и** отказ от
14-дневного права; /privacy — ссылкой-уведомлением под чекбоксом, не частью
«соглашаюсь». В `subscription_data.metadata` едет один строковый ключ —
`tos_version` (редакция /terms). **Времени принятия в записи нет намеренно:**
время в параметрах создания попадает в дайджест ключа идемпотентности
(уникальный ключ на вызов = двойное списание), а округление до часа ради
стабильности ключа датирует принятие задним числом; точное время — `created`
самой сессии Stripe, которое не может предшествовать отметке. Отметка —
утверждение клиента: сервер отказывает клиенту, приславшему «не отмечено», но
доказать, что галочку поставил человек, не может ни один чекбокс. **Новой
колонки и нового хранилища не заводится** — минимизация. `tos_version` не
стирается после `Purchase` (в отличие от `capi_*`): это часть записи о договоре.
Стирание — по общему каскаду аккаунта. Новых процессоров нет: Apple и Google —
кошельки внутри существующего платёжного потока Stripe, реквизиты у нас не оседают.


## 4. Устройство пользователя — cookies и хранилища

| Cookie | Кто ставит | Содержимое | Срок | httpOnly |
|---|---|---|---|---|
| `cookie_consent` | `proxy.ts` (гео-дефолт вне EU/EEA/UK/CH) / баннер | `{necessary, marketing, ts, v}` | 1 год | нет |
| `matio_aid` | `proxy.ts` | случайный UUID — ключ `visitors` | 395 дней, без продления | да |
| `trial_session` | `/api/playback-token` | UUID — ключ `trial_sessions` | 1 год (`ONE_YEAR_SECONDS`) | да |
| `attribution_first` / `attribution_last` | `proxy.ts` | `{s,m,c}` UTM | 90 / 30 дней | нет |
| `_fbc` | `proxy.ts` из `?fbclid` (при согласии) | click id Meta | 90 дней | нет |
| `_fbp` | Meta Pixel | browser id | по Meta | нет |
| `checkout_claim` | `startGuestCheckout` | токен привязки браузера к Checkout Session | 30 дней (`CLAIM_COOKIE_MAX_AGE`) | да |
| `locale`, `admin_locale` | переключатели | `es`/`en`, `ru`/`en` | 1 год | нет |
| `__session`, `__client_uat` | Clerk | сессия | по Clerk | да |
| `ph_*` | PostHog | distinct_id, сессия | по PostHog | нет |
| `_ga`, `_ga_*` | GA4 | client id | до 2 лет | нет |
| `__oppref`, `__oaiq_consent` | OpenAI oaiq | click id; выбор согласия | по OpenAI / 30 дней | нет |
| `muxData` / viewer-id | Mux Data | viewer id | по Mux | нет |

`localStorage` и SecureStore — см. §1 (последние две строки).

**Юр. страницы из приложения (#310).** Settings открывает `/terms`,
`/privacy`, `/cookies` (и `/es`-двойники) во встроенном браузере
(`expo-web-browser` — SFSafariViewController / Custom Tab): это сайт, а не
приложение — свой cookie-jar браузера, IP и UA уходят Vercel, как у любого
визита. Ссылки идут с `?embed=app` (`/v1/config` +
`mobile/src/i18n/localized-url.ts:legalUrl`): на таком запросе `proxy.ts` не
пишет ни одной cookie (ни `cookie_consent`, ни `matio_aid`, ни атрибуции, ни
`locale`), а layout рендерит только документ — без баннера, без загрузчиков
Meta / GA4 / PostHog / OpenAI и без маяка `/api/t`. Остаётся фронтенд-скрипт
Clerk (`ClerkProvider` оборачивает каждую страницу, `clerk.matio.tv`) — это
auth-процессор, не трекер; его cookies — в строке `__session` выше. Ссылки
между документами остаются внутри embed (`components/site/legal-link.tsx`),
выхода на главную нет.

С #312 те же `/terms` и `/privacy` открывает и строка под кнопкой шага email
формы входа приложения («By continuing you agree to the Terms and acknowledge
the Privacy Policy», es/en в `lib/i18n/app-dictionaries.ts`) — тем же
`legalUrl`. Это уведомление, не чекбокс: отметки о принятии нигде не
хранится (ни поля, ни метаданных) — минимизация. `/privacy` §11 «Our mobile
app» — уведомление ст. 13 для приложения (DRAFT до ревью юристом, #168):
device id и его строки `trial_sessions` (30 дней; оговорка про привязку к
аккаунту через IP-фолбэк веба ещё в тексте, хотя с #349 фолбэк строки устройств
не берёт — упрощение абзаца ждёт «да» владельца, реестр), счётчики `watch_segments`
без идентификатора, что уходит в Clerk и в `watch_progress`/`watch_days`,
только-локальные язык и автоплей, отсутствие аналитики/трекинга в
приложении, отчёты об ошибках в Sentry (#317 — строка §3 выше; до 90 дней
по тарифу), «Delete account» (#309) и contact@. Меняешь что-то из этого —
правь §11 (en + es) ТЕМ ЖЕ PR; тест `app/(public)/privacy/app-section.test.tsx`
берёт окно ретеншена из `lib/retention.ts`.

## 5. Дыры — стирание/ретеншен, которые ещё не реализованы

Каждая дыра — issue на доске (`tech`) и строка в `docs/registry.md`. Чинить в
PR этапа 10 не требовалось; закрывающий PR убирает строку здесь ТЕМ ЖЕ PR.

| # | Дыра | Где |
|---|---|---|
| #165 | сырой IP и UA (`capi_ip`/`capi_ua`) живут в `subscription_data.metadata` у Stripe бессрочно после единственного `Purchase` | `lib/capi-identity.ts`, `lib/subscription-mirror.ts` |
| #336 | самообслуживаемое удаление (#309): строка `users` с адресом может пережить стирание — heal из Clerk, записавший после финального взгляда маршрута (миллисекунды; закрывается вебхуком `user.deleted`, #172, строка в `docs/registry.md`); сбой отмены подписки Stripe под ответом `ok` (решение владельца). Закрыто в #336: поздняя доставка `user.created` (вебхук сначала спрашивает Clerk `users.getUser`, 404 → ничего не пишет) и таймаут клиента после того, как сервер всё сделал (приложение спрашивает Clerk о сессии: её нет → выход и главная, как при успехе) | `app/api/v1/account/delete/route.ts`, `lib/admin.ts`, `lib/erase-user.ts` |

Не дыры, а решения владельца (пометки для юриста — список в PR этапа 10):
гео-дефолт согласия вне EU/EEA/UK/CH; consent-exempt статус `matio_aid` для
AEPD; отсутствие возрастного гейта; расхождения текста `/privacy` с фактом
(§1–§2). Удаление `show_reminders` вместе с аккаунтом — решение PR #161
(до него строки намеренно переживали аккаунт).

Закрыто: #162 — ретеншен исполняет ежедневный крон (`lib/retention.ts` +
`/api/cron/retention`); что осталось от него — не код, а текст: `/privacy`
обещает «логи 30 дней», а Vercel хранит Hobby 1 ч / Pro 1 сутки, и §6 не
называет ни отправленные напоминания, ни дни просмотра — обе пометки юристу
в `docs/registry.md`; `CRON_SECRET` на обоих проектах Vercel — ops владельца.
#161 — `user.deleted` стирает `users` + каскады + `show_reminders`
по адресу; ops-хвост (подписка прод-эндпойнта Clerk на событие) — в
`docs/registry.md`. #164, блокеры включения платежей (#155): живая подписка
Stripe отменяется на конец периода тем же обработчиком, а стёртый customer
id тумбстоунится в `erased_customers`, чтобы вебхук Stripe с `guest = "1"`
не воскресил аккаунт через `claimGuestCheckout`; #223 — тумбстоун покрывает
ВСЕХ клиентов по адресу (`customers.search` в Stripe ДО `DELETE FROM users`,
best-effort, только при платёжном следе и только точное совпадение адреса),
а не только id из строки `users`. #163 — доступ и
портируемость: `pnpm export-user-data <userId>` (`scripts/export-user-data.ts`
поверх `lib/user-export*.ts`) собирает девять таблиц §2 (девятая — `idea_submissions`, #297) плюс Clerk / Stripe /
PostHog best-effort в JSON-файл `0600`; приём, верификация, ответ и реестр
заявок — `docs/runbooks/gdpr-requests.md`. #180 — стирание у процессоров,
часть 2: обработчик `user.deleted` вынесен в `lib/erase-user.ts:eraseUser` и
ПОСЛЕ локальных DELETE удаляет PostHog person по Clerk id вместе с событиями
(best-effort, честный статус, ручной путь в ранбуке §4);
`pnpm erase-user <id> [--apply]` повторяет то же стирание без вебхука
(dry-run по умолчанию); #339 — две таблицы, живущие без аккаунта
(`show_reminders`, `idea_submissions`), обслуживаются скриптами по адресу:
`pnpm export-email <адрес>` и `pnpm erase-email <адрес> [--apply]`
(`lib/address-requests.ts`, обе таблицы по адресу в нижнем регистре, стирание —
одной транзакцией, адрес с аккаунтом отклоняется с id аккаунта; новых данных и
процессоров нет); реестр заявок ранбука (§6) — список, по которому
§7 `db-restore.md` переприменяет стирания после восстановления. Stripe
`customers.del` — по-прежнему решение владельца (`docs/registry.md`).
