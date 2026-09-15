# Runbook: мобильные сборки (EAS) и TestFlight

Живой документ: сменился аккаунт, команда Apple, профиль сборки или порядок
подачи — обновить здесь тем же PR.

## Аккаунты (решение владельца 15.09.2026, #99)

| Что | Значение | Примечание |
|---|---|---|
| Apple Developer Program | Team **`MTFRZQ8SRX`**, тип **Individual** (Personal Team, оплачен) | тот же, что у Focu (репо agentapp); продавец в App Store — физлицо. Перенос на Organization-аккаунт DEEP ORDINARY LTD (D-U-N-S, проверка Apple 1–2 нед.) — App Transfer в App Store Connect перед публичной подачей, строка в `docs/registry.md` |
| Expo / EAS | организация **`matvei-dev`**, проект **`@matvei-dev/matio`**, id `755ce20c-6975-4c09-99f4-082d1386dacf` | https://expo.dev/accounts/matvei-dev/projects/matio ; логин на машине владельца (`eas whoami`) |
| iOS App ID | `tv.matio.app` | регистрируется EAS при первой сборке |
| Android | `tv.matio.app` | Google Play Console ($25) ещё не заведён; keystore после первой сборки — **бэкап обязателен** (`eas credentials`), потерянный keystore = приложение нельзя обновить никогда |

## Профили (`mobile/eas.json`)

- `development` — dev client, internal, API на `http://localhost:3100` (ad-hoc, нужна регистрация UDID: `eas device:create`).
- `preview` — internal/ad-hoc сборка релизного бандла, API по умолчанию `https://matio.tv` (`mobile/src/api/client.ts`; стенд за Basic Auth приложению недоступен).
- `production` — store-дистрибуция, `autoIncrement` номера сборки, версия из удалённого источника (`appVersionSource: remote`) — `version` в `app.json` не трогать руками.

## Первая сборка → TestFlight (владелец, интерактивно)

```
cd mobile
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

(`@latest` обязателен: глобальный `eas-cli` на машине владельца — 19.x, а `eas.json` требует ≥ 24.) Запускать в обычном терминале, НЕ через `! …` основной сессии — там нет TTY, и EAS не может спросить логин Apple («Credentials are not set up. Run this command again in interactive mode»). После первого раза сертификат живёт на сервере EAS, и следующие сборки идут с `--non-interactive` откуда угодно.

Что спросит и что отвечать: логин Apple ID (пароль + код 2FA — вводит только
владелец), «Register bundle identifier tv.matio.app?» → yes, «Generate a new
Apple Distribution Certificate / Provisioning Profile?» → yes (EAS хранит их у
себя), при submit — «Create the app in App Store Connect?» → yes. Сборка
~15–25 мин; после обработки Apple (~10 мин) она появляется в App Store Connect
→ TestFlight → Internal Testing: добавить себя тестером и поставить через
приложение TestFlight на телефоне.

## Следующие сборки

- Код в `main` → `cd mobile && npx eas-cli@latest build -p ios --profile production --auto-submit --non-interactive`.
  Не запускать одновременно с тяжёлой сборкой веба на этой машине (сборка идёт
  в облаке EAS, но `prebuild` и загрузка проекта — локально).
- `ios/` и `android/` в репо не коммитятся (CNG): EAS делает `expo prebuild`
  сам из `app.json`; локальные папки после `expo run:*` игнорируются gitignore
  и в облако не уходят.
- Внешние тестеры TestFlight и подача в App Store — после App Transfer на
  аккаунт компании (или осознанно с продавцом-физлицом).

## Грабли

- `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` стоит в `app.json` нарочно: без него App Store Connect требует ручной ответ про экспорт шифрования перед КАЖДЫМ тестом сборки (приложение использует только HTTPS — исключение по правилам Apple).

- Первая сборка требует живой сессии Apple ID; агенту её не отдавать —
  пароль и 2FA вводит владелец через `! …` в основной сессии.
- `--auto-submit` на первой сборке создаёт запись приложения в App Store
  Connect; название «Matio» должно быть свободно в сторе — если занято, EAS
  спросит другое, тогда `ascAppId` в `eas.json → submit.production`.
- `eas build` читает переменные из `eas.json → env` во время сборки; секретов
  у приложения нет (публичный `pk_test`/`pk_live` Clerk задаётся в
  `mobile/src/auth/clerk.tsx` через `EXPO_PUBLIC_*`) — ничего в `.env`
  мобильного не класть.
