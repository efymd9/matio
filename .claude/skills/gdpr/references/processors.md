# Процессоры Matio — кто видит персональные данные

Сверено **06.09.2026** по публичным страницам вендоров (ссылки в таблице).
Что именно уходит каждому — `data-map.md` §3. Новый сервис, который видит
данные, = новая строка здесь ТЕМ ЖЕ PR + строка в `docs/registry.md`, пока
статус DPA не подтверждён.

**27.09.2026 (#297, страница идей `/ideas`): код новых процессоров не
добавляет.** Идеи хранятся в Neon и проходят через Vercel (оба уже в
таблице), события `idea_submitted` / `SubmitApplication` уходят PostHog и
Meta (оба уже в таблице), писем нет (Resend идей не видит). Исправлена
неточность: публичный ящик студии, через который она отвечает авторам и
принимает запросы субъектов, видит входящую переписку — отдельная строка
ниже. До 08.10.2026 это был `contact@matio.tv` на Namecheap PrivateEmail; к
08.10 почта домена уже на **Google Workspace** (`dig MX matio.tv` →
`smtp.google.com`, SPF `include:_spf.google.com`), а contact@ не работает —
публичный адрес сменён на `maksym@matio.tv` (#414).

**15.10.2026 (#376, страница вакансий `/careers`): новых процессоров нет.**
Заявки кандидатов хранятся в Neon и проходят через Vercel (оба уже в
таблице); единственное событие — `job_application_submitted {position}` в
PostHog по согласию (уже в таблице); Meta Pixel и GA4 на `/careers` **не
загружаются вовсе до #341** (решение владельца, `lib/ad-pixels.ts`) — их
автоматический сбор полей формы не сверен; PostHog и пиксель ChatGPT Ads на
странице остаются;
писем нет (Resend заявок не видит). Кандидат пишет студии на тот же ящик
`maksym@matio.tv` (строка Google Workspace ниже). `/privacy` §4 с этой
редакции называет обработчиком ящика Google Ireland Ltd (Google Workspace), а
не Namecheap PrivateEmail.

**27.10.2026 (#485, страница `/support` + сверка `/privacy` перед первой
подачей в App Store, #486): новых процессоров код не добавляет.** Строка
Clerk дополнена тем, что он хранит на каждую сессию сам: последняя
активность — IP, **город и страна по геолокации IP**, браузер, тип
устройства (объект `SessionActivity`); `/privacy` §2/§4/§11 с этой редакции
это называют (в App Privacy — Coarse Location, связано с пользователем).
Строка Google Workspace сверена с публичным Cloud Data Processing Addendum.
Попутно: DNS `matio.tv` с ~17.10 — Cloudflare, и апекс проксируется через
него — процессор, которого в таблице нет, разбор в #488; адрес поддержки в
прод-Clerk — мёртвый `contact@` (#487).

**04.10.2026 (#277, вход через Apple и Google в приложении iOS): новых
процессоров нет.** Данные входа принимает и хранит Clerk (уже в таблице).
Apple и Google появляются как **провайдеры входа** — раздел «Не процессоры»
ниже; вход Google на вебе (модалка Clerk) существовал и раньше, теперь
записан явно.

Легенда «DPA»: *авто* — DPA инкорпорирован в условия сервиса самим фактом
использования; *подписать* — требует отдельного действия в аккаунте
(сгенерировать/принять); *проверить* — механизм есть, но факт принятия для
нашего аккаунта из кода/доков не виден — ops-шаг владельца.

| Сервис (юрлицо) | Роль / что видит | Регион обработки | DPA | Механизм трансфера EU/UK → US | Сверено (страница, дата документа) |
|---|---|---|---|---|---|
| **Vercel Inc.** | хостинг, edge, runtime-логи, Blob (артворк + шифрованные дампы) | функции `fra1`, Blob Франкфурт, edge/CDN глобально; компания US | авто (DPA «binding upon entering the Agreement») | SCC 2021/914 (модули 1–3) + UK IDTA; DPF в DPA не заявлен | https://vercel.com/legal/dpa — обновлён 17.03.2026, в силе с 31.03.2026; субпроцессоры: https://security.vercel.com |
| **Neon, LLC** (Databricks) | база данных — все таблицы | AWS eu-central-1 (Франкфурт) | **проверить**: Databricks «offers … the ability to enter into a DPA» — https://www.databricks.com/legal/databricks-data-processing-addendum; `neon.com/dpa` теперь отдаёт Product Specific Schedule Databricks (05.08.2026) | DPF: в сертификации Databricks перечислена **Neon, LLC**; SCC для EEA/CH | https://www.databricks.com/legal/privacynotice — 09.01.2026 |
| **Clerk Inc.** | аутентификация: email, креды, сессии — на каждую последняя активность (`SessionActivity`: IP, **город и страна, «resolved by IP address geo-location»**, браузер и версия, тип устройства, `isMobile`; наш код её не читает — #485). Срока хранения записей сессии Clerk не публикует: DPA §9 говорит лишь об удалении всех данных клиента в течение 90 дней после окончания договора, документация `deleteUser` — только «Deletes the given User»; `/privacy` привязывает их к аккаунту (§6 «Account») — допущение, `docs/registry.md` | Google Cloud + Cloudflare (регион в DPA не раскрыт; компания US) | авто (DPA «incorporated into and forms part of the Agreement») | DPF (самосертификация) → SCC модули 2/3 как fallback; UK Approved Addendum | https://clerk.com/legal/dpa — 26.11.2024; субпроцессоры: https://trust.clerk.com; поля сессии — https://clerk.com/docs/reference/backend/types/backend-session-activity (сверено 27.10.2026) |
| **Stripe Payments Europe Ltd** (SPEL, Ирландия) | платежи: Customer, billing address, карта (токен), инвойсы, `metadata` подписки (CAPI-снимок `_fbp`/`_fbc`/сырой IP/UA — только до `Purchase`, затем стирается, #165; версия принятых Условий `tos_version` (кошелёк на paywall, без метки времени) — хранится постоянно, #210/#214; при стирании аккаунта С платёжным следом (есть `stripe_customer_id` или строка `subscriptions`) адрес уходит в Stripe ещё раз — как запрос `customers.search` по email (#223), чтобы тумбстоунить все его Customer'ы; аккаунт без следа (эпоха free/gate) не ищется — так адрес уходит только туда, где он уже есть, нового ничего не передаётся) | ЕС; передачи Stripe, LLC (US) и аффилиатам | авто (DPA «forms part of the Agreement»; контрагент вне Америк — SPEL) | DPF / EEA SCC / UK IDTA — по выбору Stripe | https://stripe.com/legal/dpa — 18.11.2025 |
| **Mux Inc.** | видео: ассеты (контент), CDN-логи доставки (IP/UA зрителя), Mux Data (по согласию) | США | авто (ToS §11: DPA «incorporated herein» когда Mux обрабатывает персональные данные от нашего имени) | DPF (EU-US + UK Extension + Swiss-US) | https://www.mux.com/terms и https://www.mux.com/privacy — 19.03.2026; DPA PDF — https://www.mux.com/dpa (01.04.2025) |
| **Resend Inc.** | письма: адрес, тема, тело; логи доставки | США; отправка из AWS eu-west-1; 21 субпроцессор, все US | авто (DPA «binding upon Customer entering into the Agreement») | SCC модуль 2 + UK Addendum; DPF (EU-US + UK Extension) | https://resend.com/legal/dpa и https://resend.com/legal/subprocessors — 27.08.2026; логи 30 дней (https://resend.com/security/gdpr) |
| **PostHog Inc.** | продуктовая аналитика: события, персона по Clerk id (без `email` с #466; у опознанных раньше свойство снимается через API), session replay (маска) | PostHog Cloud **EU** — Франкфурт | **подписать**: DPA действителен только сгенерированный и контрподписанный в приложении (app.posthog.com/legal) — факт подписи для нашего проекта проверить | DPF (EU-US, UK Extension, Swiss-US) + SCC | https://posthog.com/dpa; регион: https://posthog.com/docs/privacy/gdpr-compliance |
| **Meta Platforms Ireland Ltd** (+ Meta Platforms, Inc.) | реклама: Pixel (браузер; с #297 и `SubmitApplication` на `/ideas`), CAPI (SHA-256 email/id, `_fbp`/`_fbc`, IP, UA, `Purchase`). **Automatic Advanced Matching: не сверено** ни для одного ID из `NEXT_PUBLIC_META_PIXEL_ID` + `NEXT_PUBLIC_META_PIXEL_IDS` — `meta-pixel.tsx` делает голый `fbq('init', id)`, и включённый AAM сам хеширует поля email/имени со страницы (`/ideas`, форма напоминаний) в обход гейтов кода. Сверяет владелец (Events Manager → пиксель → Settings → Automatic advanced matching = off), агент записывает ответ с датой; до того — `docs/registry.md` (строка AAM / GA4, #297) → #341, реклама на `/ideas` заблокирована | Ирландия / США | авто через Business Tools Terms + Data Processing Terms (Meta — процессор лишь для части операций; для остального — самостоятельный/совместный контролёр — **вопрос юристу**) | European Data Transfer Addendum; Meta Platforms, Inc. сертифицирована по DPF (страница DPF Meta из агента не читается — сверено по вторичным источникам, открыть руками: https://www.facebook.com/privacy/policies/data_privacy_framework/) | https://www.facebook.com/legal/terms/dataprocessing — в силе с 23.08.2025 |
| **Google Ireland Ltd** / Google LLC | GA4: page_view, события, client id. **«User-provided data collection → automatic detection»: не сверено** — если включено, gtag сам ищет email на странице (`/ideas`, форма напоминаний). Сверяет владелец (GA4 Admin → Data collection → автоопределение = off); до того — `docs/registry.md` (строка AAM / GA4, #297) → #341 | Ирландия / США | **проверить**: Google Ads Data Processing Terms применяются только к сервисам, для которых приняты — в GA4 Admin принять «Data Processing Terms» | DPF для Ads Services с 01.09.2023; SCC там, где DPF не принят | https://business.safety.google/adsprocessorterms/ (v8.0, 30.05.2024), https://business.safety.google/adsdatatransfers/ |
| **OpenAI Ireland Ltd** | ChatGPT Ads pixel: `page_viewed`, конверсии с `event_id` = `signup:<Clerk id>` / sub id, `__oppref` | Ирландия / США | авто: Ad Tools DPA — часть Advertising Terms («effective upon incorporation by reference»); **стороны — независимые контролёры**, не процессор (кроме «Restricted Processing») — учесть в политике; страница отдаёт 403 из агента — сверено по вторичным источникам, открыть руками | SCC + UK Addendum; **записи в DPF у OpenAI нет** | https://openai.com/policies/ad-tools-dpa/ , https://openai.com/policies/advertising-terms/ , https://openai.com/policies/eu-privacy-policy/ |
| **Functional Software, Inc.** (Sentry) | ошибки/трейсы: `user.id`, URL без query, UA; **приложение** (#317, тот же проект, только в сборке с `EXPO_PUBLIC_SENTRY_DSN`): JS-ошибки после тех же скрабберов + нативные крэши (стек, контекст устройства, случайный installation id SDK — не Clerk id); без сессий release health | организация в **EU-регионе** (данные в ЕС); компания US | **проверить**: DPA v5.1.0 «amends the Agreement», требует отдельного принятия («enter into our DPA») в настройках организации | DPF → SCC при инвалидации; UK Addendum | https://sentry.io/legal/dpa/ — 29.05.2024; ретеншен: https://docs.sentry.io/security-legal-pii/security/data-retention-periods/ |
| **Google Ireland Ltd** (Google Workspace — почта домена) | почтовый ящик `maksym@matio.tv` (публичный контакт с 08.10.2026, #414; с #485 — и адрес страницы `/support`): входящая и исходящая переписка — запросы субъектов (доступ, копия, удаление — на сайте удаление аккаунта идёт письмом), вопросы поддержки (вход, приложение, подписка), ответы авторам идей (#297), переписка с кандидатами по заявкам с `/careers` (#376), любые письма зрителей; адрес отправителя и всё, что он написал | «Customer Data may be processed in any country where Google or its Subprocessors maintain facilities» (CDPA §10.1), если не заданы data regions — для нашего аккаунта не сверено | **проверить**: Cloud Data Processing Addendum (бывший Data Processing Amendment для Workspace) действует с даты, когда клиент его принял («Addendum Effective Date»), — принят ли для нашего аккаунта, видно только в Google Admin → `docs/registry.md` (строка «почта домена — Google Workspace», #414) | SCC (CDPA, Appendix 3 §4.1) или Alternative Transfer Solution, если Google его принял — https://cloud.google.com/terms/alternative-transfer-solution (из агента не читается, открыть руками); `/privacy` §4 пишет «SCCs» — с CDPA не расходится | https://cloud.google.com/terms/data-processing-addendum — last modified 08.06.2026, сверено 27.10.2026; MX сверены 08.10.2026 и 27.10.2026 (`dig MX matio.tv` → `smtp.google.com`, SPF `include:_spf.google.com`); до 08.10 — Namecheap PrivateEmail (MX `mx1/mx2.privateemail.com`, сверено 27.09.2026) |
| **GitHub, Inc.** (Microsoft) | CI: раннеры `db-backup` (дамп в открытом виде до шифрования) и `db-restore-check` (полное восстановление на время джобы); секреты `BACKUP_*` | США | авто (DPA «forms part of the GitHub Customer Agreement») | DPF (EU-US, UK Extension, Swiss-US) + SCC модули 1–3 + UK Addendum | https://github.com/customer-terms/github-data-protection-agreement — октябрь 2025 |

## Не процессоры (для ясности)

- **Anthropic / Claude Code** — инструмент разработки; по дизайну персональные
  данные в контекст агентов не попадают (правило в SKILL.md). Станет
  процессором в тот день, когда первый LLM-вызов увидит данные пользователей.
- **Namecheap** как регистратор домена (whois, 27.10.2026) и **Expo/EAS**
  (сборки приложения) — не видят данных пользователей. Почта
  `maksym@matio.tv` — Google Workspace, она видит переписку: это процессор,
  строка в таблице выше (#297, #414). **Cloudflare** — DNS зоны `matio.tv`
  с ~17.10.2026 (NS `dana`/`peter.ns.cloudflare.com`, #458), а пока апекс
  проксируется (27.10.2026: `server: cloudflare`, `cf-ray` на
  `https://matio.tv/api/healthz`) — ещё и TLS-прокси всего трафика сайта: в
  этой роли он процессор, которого в таблице нет, — #488 (решение владельца:
  DPA + строка + `/privacy` §4 или «DNS only»). Пуши (#98) добавят Expo push
  service / FCM / APNs — строка здесь ДО первого пуша.
- **Cloudflare**, **AWS** — субпроцессоры Clerk/Resend/Neon, не наши
  контрагенты; числятся в их списках.
- **Google LLC / Google Ireland Ltd** и **Apple Inc. / Apple Distribution
  International Ltd** как **провайдеры входа** (#277: «Continue with Google»
  в приложении iOS и в модалке Clerk на вебе; «Sign in with Apple» в
  приложении iOS и в модалке Clerk на вебе — после включения соединения
  Apple в Clerk) — самостоятельные контролёры аккаунта пользователя у себя,
  не обрабатывают данные по нашему поручению; DPA с ними не заключается.
  Видят факт входа в Matio: Google — iOS client id приложения и Web client id
  Clerk, Apple — bundle id `tv.matio.app` / Team `MTFRZQ8SRX` (на вебе —
  Services ID соединения Clerk). От них через
  Clerk мы получаем поля из `data-map.md` §1 (адрес — у Apple, возможно,
  relay-адрес `…@privaterelay.appleid.com`; имя — у Apple только при первом
  входе; у Google — фото профиля; id пользователя у провайдера). Сверено по
  коду 04.10.2026; **классификация — вопрос юристу** (строка в
  `docs/registry.md`).
  **Отзыв гранта Apple при удалении (#407, 09.10.2026)** классификацию не
  меняет: маршрут `POST /api/v1/account/delete` отправляет Apple
  (`appleid.apple.com/auth/token` → `/auth/revoke`) её же свежий
  authorization code из листа на устройстве и наш client secret (JWT,
  подписанный ключом Sign in with Apple); получает токены (id_token несёт
  адрес Apple ID) и тут же отзывает refresh-токен — ничего не хранится и не
  логируется (`lib/apple-revoke.ts`). Новых данных Apple не получает — это
  указание контролёру забыть наш доступ к Apple ID (ст. 17), не поручение
  обработки. Новый секрет в env Vercel: `APPLE_SIGN_IN_PRIVATE_KEY` (+ Key
  ID, Team ID).

## Ops-хвосты для владельца (из колонки «DPA»)

1. Neon/Databricks — принять DPA для аккаунта (ссылка в таблице) или получить
   подтверждение, что он покрыт условиями Neon.
2. PostHog — сгенерировать и контрподписать DPA в app.posthog.com/legal.
3. Sentry — принять DPA в настройках организации.
4. Google — принять Data Processing Terms в GA4 Admin.
5. Meta — подтвердить принятие Business Tools Terms в Business Manager.
6. OpenAI — Advertising Terms принимаются в Ads Manager; в `/privacy`
   OpenAI сегодня не упомянут как получатель (есть только в `/cookies`) —
   юристу.
7. План Vercel (Hobby/Pro) — от него зависит ретеншен логов, обещанный в
   `/privacy` как 30 дней.
8. Google Workspace (почта домена) — подтвердить в Google Admin, что Cloud
   Data Processing Addendum (бывший Data Processing Amendment) принят для
   аккаунта с ящиком `maksym@`, записать регион данных и принятый Google
   механизм трансфера (#297, #485; строка в `docs/registry.md`).
9. Meta AAM и автоопределение GA4 — выключены ли (для каждого пикселя и для
   свойства GA4); ответ с датой — в строки Meta и Google выше (#297, #341). Блокирует
   рекламу на `/ideas` наравне с ревью юриста.

Все девять — вопросы владельца/юриста, не кода; открыть как issue после решения
владельца (label `needs:owner`).
