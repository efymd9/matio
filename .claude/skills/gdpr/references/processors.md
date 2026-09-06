# Процессоры Matio — кто видит персональные данные

Сверено **06.09.2026** по публичным страницам вендоров (ссылки в таблице).
Что именно уходит каждому — `data-map.md` §3. Новый сервис, который видит
данные, = новая строка здесь ТЕМ ЖЕ PR + строка в `docs/registry.md`, пока
статус DPA не подтверждён.

Легенда «DPA»: *авто* — DPA инкорпорирован в условия сервиса самим фактом
использования; *подписать* — требует отдельного действия в аккаунте
(сгенерировать/принять); *проверить* — механизм есть, но факт принятия для
нашего аккаунта из кода/доков не виден — ops-шаг владельца.

| Сервис (юрлицо) | Роль / что видит | Регион обработки | DPA | Механизм трансфера EU/UK → US | Сверено (страница, дата документа) |
|---|---|---|---|---|---|
| **Vercel Inc.** | хостинг, edge, runtime-логи, Blob (артворк + шифрованные дампы) | функции `fra1`, Blob Франкфурт, edge/CDN глобально; компания US | авто (DPA «binding upon entering the Agreement») | SCC 2021/914 (модули 1–3) + UK IDTA; DPF в DPA не заявлен | https://vercel.com/legal/dpa — обновлён 17.03.2026, в силе с 31.03.2026; субпроцессоры: https://security.vercel.com |
| **Neon, LLC** (Databricks) | база данных — все таблицы | AWS eu-central-1 (Франкфурт) | **проверить**: Databricks «offers … the ability to enter into a DPA» — https://www.databricks.com/legal/databricks-data-processing-addendum; `neon.com/dpa` теперь отдаёт Product Specific Schedule Databricks (05.08.2026) | DPF: в сертификации Databricks перечислена **Neon, LLC**; SCC для EEA/CH | https://www.databricks.com/legal/privacynotice — 09.01.2026 |
| **Clerk Inc.** | аутентификация: email, креды, сессии (IP/UA/устройство) | Google Cloud + Cloudflare (регион в DPA не раскрыт; компания US) | авто (DPA «incorporated into and forms part of the Agreement») | DPF (самосертификация) → SCC модули 2/3 как fallback; UK Approved Addendum | https://clerk.com/legal/dpa — 26.11.2024; субпроцессоры: https://trust.clerk.com |
| **Stripe Payments Europe Ltd** (SPEL, Ирландия) | платежи: Customer, billing address, карта (токен), инвойсы, `metadata` подписки | ЕС; передачи Stripe, LLC (US) и аффилиатам | авто (DPA «forms part of the Agreement»; контрагент вне Америк — SPEL) | DPF / EEA SCC / UK IDTA — по выбору Stripe | https://stripe.com/legal/dpa — 18.11.2025 |
| **Mux Inc.** | видео: ассеты (контент), CDN-логи доставки (IP/UA зрителя), Mux Data (по согласию) | США | авто (ToS §11: DPA «incorporated herein» когда Mux обрабатывает персональные данные от нашего имени) | DPF (EU-US + UK Extension + Swiss-US) | https://www.mux.com/terms и https://www.mux.com/privacy — 19.03.2026; DPA PDF — https://www.mux.com/dpa (01.04.2025) |
| **Resend Inc.** | письма: адрес, тема, тело; логи доставки | США; отправка из AWS eu-west-1; 21 субпроцессор, все US | авто (DPA «binding upon Customer entering into the Agreement») | SCC модуль 2 + UK Addendum; DPF (EU-US + UK Extension) | https://resend.com/legal/dpa и https://resend.com/legal/subprocessors — 27.08.2026; логи 30 дней (https://resend.com/security/gdpr) |
| **PostHog Inc.** | продуктовая аналитика: события, `email` персоны, session replay (маска) | PostHog Cloud **EU** — Франкфурт | **подписать**: DPA действителен только сгенерированный и контрподписанный в приложении (app.posthog.com/legal) — факт подписи для нашего проекта проверить | DPF (EU-US, UK Extension, Swiss-US) + SCC | https://posthog.com/dpa; регион: https://posthog.com/docs/privacy/gdpr-compliance |
| **Meta Platforms Ireland Ltd** (+ Meta Platforms, Inc.) | реклама: Pixel (браузер), CAPI (SHA-256 email/id, `_fbp`/`_fbc`, IP, UA, `Purchase`) | Ирландия / США | авто через Business Tools Terms + Data Processing Terms (Meta — процессор лишь для части операций; для остального — самостоятельный/совместный контролёр — **вопрос юристу**) | European Data Transfer Addendum; Meta Platforms, Inc. сертифицирована по DPF (страница DPF Meta из агента не читается — сверено по вторичным источникам, открыть руками: https://www.facebook.com/privacy/policies/data_privacy_framework/) | https://www.facebook.com/legal/terms/dataprocessing — в силе с 23.08.2025 |
| **Google Ireland Ltd** / Google LLC | GA4: page_view, события, client id | Ирландия / США | **проверить**: Google Ads Data Processing Terms применяются только к сервисам, для которых приняты — в GA4 Admin принять «Data Processing Terms» | DPF для Ads Services с 01.09.2023; SCC там, где DPF не принят | https://business.safety.google/adsprocessorterms/ (v8.0, 30.05.2024), https://business.safety.google/adsdatatransfers/ |
| **OpenAI Ireland Ltd** | ChatGPT Ads pixel: `page_viewed`, конверсии с `event_id` = `signup:<Clerk id>` / sub id, `__oppref` | Ирландия / США | авто: Ad Tools DPA — часть Advertising Terms («effective upon incorporation by reference»); **стороны — независимые контролёры**, не процессор (кроме «Restricted Processing») — учесть в политике; страница отдаёт 403 из агента — сверено по вторичным источникам, открыть руками | SCC + UK Addendum; **записи в DPF у OpenAI нет** | https://openai.com/policies/ad-tools-dpa/ , https://openai.com/policies/advertising-terms/ , https://openai.com/policies/eu-privacy-policy/ |
| **Functional Software, Inc.** (Sentry) | ошибки/трейсы: `user.id`, URL без query, UA | организация в **EU-регионе** (данные в ЕС); компания US | **проверить**: DPA v5.1.0 «amends the Agreement», требует отдельного принятия («enter into our DPA») в настройках организации | DPF → SCC при инвалидации; UK Addendum | https://sentry.io/legal/dpa/ — 29.05.2024; ретеншен: https://docs.sentry.io/security-legal-pii/security/data-retention-periods/ |
| **GitHub, Inc.** (Microsoft) | CI: раннеры `db-backup` (дамп в открытом виде до шифрования) и `db-restore-check` (полное восстановление на время джобы); секреты `BACKUP_*` | США | авто (DPA «forms part of the GitHub Customer Agreement») | DPF (EU-US, UK Extension, Swiss-US) + SCC модули 1–3 + UK Addendum | https://github.com/customer-terms/github-data-protection-agreement — октябрь 2025 |

## Не процессоры (для ясности)

- **Anthropic / Claude Code** — инструмент разработки; по дизайну персональные
  данные в контекст агентов не попадают (правило в SKILL.md). Станет
  процессором в тот день, когда первый LLM-вызов увидит данные пользователей.
- **Namecheap** (домен/DNS), **Expo/EAS** (сборки приложения) — не видят
  данных пользователей. Пуши (#98) добавят Expo push service / FCM / APNs —
  строка здесь ДО первого пуша.
- **Cloudflare**, **AWS** — субпроцессоры Clerk/Resend/Neon, не наши
  контрагенты; числятся в их списках.

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

Все семь — вопросы владельца/юриста, не кода; открыть как issue после решения
владельца (label `needs:owner`).
