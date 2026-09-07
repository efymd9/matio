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
| **Neon Postgres**, проект `little-base-06482402`, ветка production | AWS eu-central-1 (Франкфурт) | все таблицы из §2 | бессрочно — джоб чистки нет (#162); PITR 6 ч |
| Neon, ветка staging | тот же регион | только сид-данные (нет аккаунтов, истории, адресов — реестр) | — |
| **Vercel Blob** `matio-blob` (public store) | Франкфурт | (а) артворк шоу + аватары виртуальных актёров — не персональное; (б) `db-backups/production/db-<UTC>.dump.age` — полный дамп базы, зашифрован age (публичный ключ в GH vars; приватный — менеджер паролей владельца + секрет `BACKUP_AGE_SECRET_KEY`), объект приватный | (б) 35 дней + самый свежий дамп всегда остаётся (`infra/backup/retention.ts`) |
| **GitHub Actions**, раннер `ubuntu-latest` | США, эфемерный | `db-backup`: дамп в открытом виде во временном каталоге до шифрования (минуты, `trap rm`); `db-restore-check` (1-го числа): полное восстановление в открытом виде в контейнере Postgres 18 на время джобы; артефактов нет, наружу — одна строка со счётчиками | жизнь джобы |
| **Vercel Functions** (`fra1`) + Edge Middleware (`proxy.ts`, глобально) | Франкфурт / edge | запрос в полёте: cookies, IP (сырой IP читается из `x-vercel-forwarded-for` и сразу хешируется; `x-vercel-ip-country` → страна), UA; runtime-логи — `console.warn/error` с id/статусами (лог-аудит `lib/log-audit.test.ts`) | логи: Hobby 1 ч / Pro 1 сутки (план — уточнить, `/privacy` обещает 30 дней) |
| Vercel Data Cache / память процесса | fra1 | `unstable_cache` `catalog` (шоу, нет PII); агрегаты PostHog/Mux Data (числа); `roleCache` в `proxy.ts` — `userId → role`, 5 с | TTL 5 с … 1 ч |
| **Clerk** (prod-инстанс, `clerk.matio.tv`) | США (GCP + Cloudflare по DPA; регион не раскрыт) | идентичность: email, пароль (хеш) или email-код, сессии (IP, UA, устройство), имя если задано, OAuth-профили | пока существует аккаунт (удаление — источник истины) |
| **Stripe** (Stripe Payments Europe Ltd) | Ирландия + US-аффилиаты | Customer (email, billing name/address), способ оплаты (токен), инвойсы, Subscription с `metadata` (см. §3) | по правилам Stripe; инвойсы — налоговые записи (6–10 лет) |
| **Mux** | США | видеоассеты (контент, не персональное); CDN-логи доставки (IP/UA зрителя на каждом сегменте — инфраструктура Mux); Mux Data (по согласию): cookie viewer-id, QoE, watch time | по правилам Mux |
| **Resend** | США (отправка из eu-west-1) | адрес получателя, тема, тело письма (название шоу/эпизода, логлайн, подписанный URL кадра), события доставки | логи 30 дней (Free/Pro/Scale) |
| **PostHog Cloud EU** | Франкфурт | события с `distinct_id` (анонимный uuid → Clerk id после `identify`), свойства персоны `{email}`, супер-свойства `locale`/`locale_source`, session replay (все input/text замаскированы), `$ip`/geo, referrer/utm | по плану PostHog (уточнить) |
| **Meta** (Pixel + CAPI) | Ирландия / США | браузерные события с `_fbp`/`_fbc`, IP/UA запроса; CAPI `Purchase` с SHA-256 email, SHA-256 Clerk id, `_fbp`, `_fbc`, сырой IP, UA | по правилам Meta |
| **Google** (GA4) | Ирландия / США | `page_view` и события gtag, client id `_ga`; user_id/email кодом не передаются | настройка ретеншена событий в свойстве GA4 (2 или 14 мес. — уточнить) |
| **OpenAI** (ChatGPT Ads pixel `oaiq`) | Ирландия / США | `page_viewed`, `registration_completed`/`subscription_created` с `event_id` = `signup:<Clerk id>` или Stripe subscription id, `plan_id`, `amount`, `currency`; cookie `__oppref` (click id), IP/UA запроса | по правилам OpenAI |
| **Sentry** (org-регион EU) | ЕС | ошибки/трейсы: `user.id` (Clerk id) и только он, URL без query, UA, `content-type`/`content-length`; без cookies, тел, breadcrumbs консоли, replay, feedback | ошибки 30/90 дней по плану |
| **Устройство — браузер** | у пользователя | cookies (таблица в §4), `localStorage`-флаги дедупа событий (`matio:fb:lead`, `matio:fb:creg:<Clerk id>`, `matio:ph:signup:<Clerk id>`, `matio:oaiq:signup:<Clerk id>`, `matio:oaiq:purchase:<sub id>`), настройки media-chrome (mute) | до очистки браузера |
| **Устройство — приложение (Expo)** | у пользователя | `expo-secure-store`: Clerk session JWT; `matio_device_id` — UUID (аналог `matio_aid`; **iOS keychain переживает переустановку**); `matio_locale` — выбранный язык (`es`/`en`, предпочтение, не идентификатор; #96) | до удаления/сброса |

## 2. Таблицы по чувствительности

**Чувствительных (ст. 9) — нет.** Все персональные данные — обычные.
Ниже — каждая таблица схемы с персональными полями, ключ стирания и ретеншен.

### Обычные персональные данные

| Таблица | Персональные поля | Класс | Как стирается | Ретеншен |
|---|---|---|---|---|
| `users` | `id` (Clerk id), `email`, `role`, `stripe_customer_id`, `signup_origin`, `country`, `attribution_{first,last}_{source,medium,campaign}`, `created_at` | PII | корень каскада: вебхук Clerk `user.deleted` → `DELETE FROM users` (`app/api/webhooks/clerk/route.ts`; идемпотентно; при живой подписке Stripe — стирает и пишет `console.error` с id для ручной отмены) | пока есть аккаунт |
| `subscriptions` | `user_id` → CASCADE, `stripe_subscription_id`, `status`, `plan`, `current_period_end`, `cancel_at_period_end`, `attribution_*`, `created_at`/`updated_at` | псевдо | каскад с `users` | с аккаунтом; налоговые записи — у Stripe, не здесь |
| `watch_progress` | `user_id` → CASCADE, `episode_id`, `position_seconds`, `max_position_seconds`, `total_watched_seconds`, `completed`, `first_watched_at`, `updated_at` | псевдо (история просмотра) | каскад с `users` | с аккаунтом |
| `watch_days` | `user_id` → CASCADE, `day` | псевдо | каскад с `users` | с аккаунтом (#162 — окно для аналитики) |
| `trial_sessions` | `session_token` (UUID cookie `trial_session` **или** `matio_device_id` приложения), `show_id`, `started_at`/`expires_at`, `user_id` → SET NULL, `converted`, `last_position_seconds`, `ip_hash` (HMAC-SHA256 IP, соль = `MUX_SIGNING_KEY_PRIVATE_KEY`), `attribution_*`, `kind`, `furthest_episode_number`, `last_episode_id`, `signup_wall_at` | псевдо | при удалении аккаунта строка остаётся без `user_id`; иначе — ничем | бессрочно; `/privacy` обещает 30 дней (#162) |
| `visitors` | `aid` (UUID cookie `matio_aid`), `first_seen_at`, `first_path`, `referrer` (сырой `document.referrer`, ≤300 символов — может нести чужие query-параметры), `utm_*`, `country`, `user_id` → SET NULL, `linked_at` | псевдо | при удалении аккаунта остаётся без `user_id`; иначе — ничем | бессрочно; `/privacy` обещает 25 месяцев (#162) |
| `visitor_days` | `aid` → CASCADE от `visitors`, `day`, `landed_home`, `show_viewed`, `wall_seen` | псевдо | каскад с `visitors` | как `visitors` |
| `show_reminders` | `email`, `show_id`, `user_id` → SET NULL, `locale`, `ip_hash`, `created_at`, `notified_at` | PII | `unsubscribeEmail` (все строки адреса, `lib/email-unsubscribe.ts`) и удаление аккаунта: `user.deleted` удаляет все строки по адресу аккаунта + по `user_id` до каскада (анонимные строки с другим адресом не затрагиваются — их стирает только отписка) | бессрочно, отправленные тоже (#162) |
| `guest_checkout_attempts` | `ip_hash`, `window_start`, `count` | псевдо | самопрунинг строк старше 2 ч (`lib/checkout-rate-limit.ts`) | 2 ч |
| `marketing_links` | `created_by` → SET NULL (id админа) | внутреннее | SET NULL | бессрочно (админские ссылки) |

### Не персональные (для полноты схемы)

`shows`, `seasons`, `episodes`, `actors` (виртуальные, вымышленные),
`show_actors` — контент. `episode_choices` (#143, ветвящееся видео) — рёбра
графа развилок между эпизодами: `from/to_episode_id`, `position`,
`label_en/es`, `is_default` — контент, вводится админом; выбор ЗРИТЕЛЯ на
развилке нигде отдельно не пишется — он материализуется как обычная строка
`watch_progress` (или `trial_sessions.last_episode_id`) на эпизоде-ветке,
то есть в уже существующем классе «история просмотра» с тем же каскадом
от `users`. Новые колонки `episodes.branch_of_episode_id` /
`fork_prompt_en/es` / `fork_window_seconds` — тоже контент.
`watch_segments` — счётчики по (эпизод, день,
10-секундный бакет), агрегат. `stripe_events` — id событий Stripe для
идемпотентности, растёт бессрочно (#162).

## 3. Что уходит во внешние сервисы — дословно какие поля

**В LLM — ничего.** LLM-вызовов над данными пользователей в коде нет.
Инструменты разработки (Claude Code, Neon MCP) имеют доступ к проду — правило
в скилле: персональные колонки в контекст агента не выгружаются.

| Куда | Когда | Что именно (поля) | Гейт |
|---|---|---|---|
| **Clerk** | регистрация/вход; `claimGuestCheckout` | всё, что вводит пользователь в Clerk UI; сервер: `users.createUser({emailAddress:[email], skipPasswordRequirement:true})`, `signInTokens.createSignInToken` (id) | договор |
| **Stripe** | `createAuthCheckoutSession` / `createGuestCheckoutSession` | `customers.create({email, metadata:{userId}})`; Checkout Session `locale`, `client_reference_id` (claim token); `subscription_data.metadata`: `userId`, `attr_first_*`/`attr_last_*` (UTM), `capi_consent`, **`capi_ip` (сырой IP)**, **`capi_ua`**, `capi_fbp`, `capi_fbc`, `ph_consent`, `guest`, `claim_token`, `trial_token`; billing address и карта — вводятся у Stripe | договор; `capi_*` и `ph_*` — только при маркетинговом согласии; `capi_ip/ua` не чистятся после использования (#165) |
| **Meta CAPI** (`lib/meta-capi.ts`) | вебхук Stripe, переход в access-granting | `Purchase`: `em` = SHA-256(email), `external_id` = SHA-256(Clerk id), `fbp`, `fbc`, `client_ip_address` (сырой), `client_user_agent`, `event_id` = sub id, `value`/`currency`, `content_ids` | `capi_consent` из метаданных |
| **Meta Pixel** (браузер) | по странице | `PageView`, `ViewContent`, `Lead`, `InitiateCheckout`, `CompleteRegistration` + `_fbp`/`_fbc`, IP/UA запроса — самим пикселем | `cookie_consent.marketing` |
| **PostHog** (браузер) | по странице | `$pageview`, `show_viewed`, `trial_play_started`, `signup_wall_shown`, `signup_completed`, `checkout_started`, … со свойствами `show_slug`, `episode_number`, `mode`, `auth`, `gate`; супер-свойства `locale`, `locale_source`; `identify(userId, {email})` после входа; session replay с маской всех input/text; UTM нормализуются в `before_send` | `cookie_consent.marketing` |
| **PostHog** (сервер, `lib/posthog-server.ts`) | вебхук Stripe | `subscribe_succeeded`: `distinctId` = Clerk id, `value`, `currency`, `plan`, `utm_*` first-touch | `ph_consent` из метаданных |
| **Google GA4** | по странице | `page_view` + события `trackGA` (без user_id/email в коде), Consent Mode v2 | `cookie_consent.marketing` |
| **OpenAI oaiq** | по странице; регистрация; возврат с оплаты | `page_viewed{type:contents}`; `registration_completed{type:customer_action}` или `subscription_created{plan_id, amount, currency}`; `options.event_id` = `signup:<Clerk id>` / Stripe sub id; cookie `__oppref` — самим SDK | `cookie_consent.marketing` |
| **Resend** | кнопка «Episode reminders» в админке | `to` = `show_reminders.email`, `subject`/`html`/`text` (название шоу, сезон/эпизод, логлайн, жанр, длительность, подписанный thumbnail-URL Mux с TTL 90 дней), `List-Unsubscribe` (HMAC адреса), `replyTo` contact@, idempotency-key = хеш id строк | явный запрос пользователя в форме |
| **Mux** | воспроизведение | JWT `aud: v` (playback id, exp ≤ 1 ч) — без PII; thumbnail JWT `aud: t`; Mux Data beacons (`player_name`, `video_series`) — только при согласии; Mux Data API — чтение агрегатов | договор; Data — согласие |
| **Sentry** | ошибка | событие после `scrubSentryEvent`: `user.id` только, URL без query/credentials, заголовки по allowlist, email-подобные строки → `[redacted-email]` | всегда (DSN задан) |
| **Vercel** | каждый запрос | edge видит IP (нами не сохраняется), cookies, UA; runtime-логи — id/статусы | инфраструктура |
| **GitHub Actions** | ночной бэкап; ежемесячная проба | полный дамп (см. §1) | инфраструктура |

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

## 5. Дыры — стирание/ретеншен, которые ещё не реализованы

Каждая дыра — issue на доске (`tech`) и строка в `docs/registry.md`. Чинить в
PR этапа 10 не требовалось; закрывающий PR убирает строку здесь ТЕМ ЖЕ PR.

| # | Дыра | Где |
|---|---|---|
| #162 | ни одной джобы ретеншена: `trial_sessions`, `visitors`/`visitor_days`, `watch_days`, отправленные `show_reminders`, `stripe_events` — бессрочно; `/privacy` обещает 30 дней / 25 месяцев; Vercel-логи короче обещанных 30 дней | вся БД |
| #163 | доступ/портируемость (ст. 15/20): ни скрипта экспорта, ни ранбука | — |
| #164 | стирание не доходит до процессоров (Stripe Customer, PostHog person с email); реестра заявок, по которому §7 ранбука восстановления велит повторять стирание, не существует | `docs/runbooks/db-restore.md` |
| #165 | сырой IP и UA (`capi_ip`/`capi_ua`) живут в `subscription_data.metadata` у Stripe бессрочно после единственного `Purchase` | `lib/capi-identity.ts`, `lib/subscription-mirror.ts` |

Не дыры, а решения владельца (пометки для юриста — список в PR этапа 10):
гео-дефолт согласия вне EU/EEA/UK/CH; consent-exempt статус `matio_aid` для
AEPD; отсутствие возрастного гейта; расхождения текста `/privacy` с фактом
(§1–§2). Удаление `show_reminders` вместе с аккаунтом — решение PR #161
(до него строки намеренно переживали аккаунт).

Закрыто: #161 — `user.deleted` стирает `users` + каскады + `show_reminders`
по адресу; ops-хвост (подписка прод-эндпойнта Clerk на событие) — в
`docs/registry.md`.
