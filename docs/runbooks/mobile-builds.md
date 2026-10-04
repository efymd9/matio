# Runbook: мобильные сборки (EAS) и TestFlight

Живой документ: сменился аккаунт, команда Apple, профиль сборки или порядок
подачи — обновить здесь тем же PR.

## Аккаунты (решение владельца 15.09.2026, #99)

| Что | Значение | Примечание |
|---|---|---|
| Apple Developer Program | Team **`MTFRZQ8SRX`**, тип **Individual** (Personal Team, оплачен) | тот же, что у Focu (репо agentapp); продавец в App Store — физлицо. Перенос на Organization-аккаунт DEEP ORDINARY LTD (D-U-N-S, проверка Apple 1–2 нед.) — App Transfer в App Store Connect перед публичной подачей, строка в `docs/registry.md` |
| Expo / EAS | организация **`matvei-dev`**, проект **`@matvei-dev/matio`**, id `755ce20c-6975-4c09-99f4-082d1386dacf` | https://expo.dev/accounts/matvei-dev/projects/matio ; логин на машине владельца (`eas whoami`) |
| iOS App ID | `tv.matio.app` | зарегистрирован 15.09.2026; запись в App Store Connect: **ASC App ID `6812321366`** (в `eas.json → submit.production.ios.ascAppId` — без него `--auto-submit`/`eas submit` в `--non-interactive` отказывают) |
| Android | `tv.matio.app` | Google Play Console ($25) ещё не заведён; keystore после первой сборки — **бэкап обязателен** (`eas credentials`), потерянный keystore = приложение нельзя обновить никогда |

## Профили (`mobile/eas.json`)

- Профиля `development` нет (#307): ему нужен `expo-dev-client` — новая зависимость, не установлена. Отладочная сборка — локально, `cd mobile && npx expo run:ios` на симуляторе (API по умолчанию `http://localhost:3100` в `__DEV__`, `mobile/src/api/client.ts`); на телефоне — `npx expo run:ios --device` с `EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP Mac>:3100` (localhost Mac'а телефону недоступен). Строка в `docs/registry.md`.
- `preview` — internal/ad-hoc сборка релизного бандла, API по умолчанию `https://matio.tv` (`mobile/src/api/client.ts`; стенд за Basic Auth приложению недоступен).
- `production` — store-дистрибуция, `autoIncrement` номера сборки. `appVersionSource: remote` ведёт на сервере EAS **только номер сборки** (`buildNumber` / `versionCode`); версия для стора — `expo.version` в `app.json`, и её **поднимают руками** перед любой сборкой, которая должна стать новой версией в App Store (#307). Иначе после одобрения 0.1.0 каждая следующая загрузка отклоняется: «train version 0.1.0 is closed». release-please её не трогает (строка в `docs/registry.md`).

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

Одна команда из основной сессии (сертификат и `ascAppId` уже есть):

```
cd mobile && npm ci && EAS_BUILD_NO_EXPO_GO_WARNING=true npx eas-cli@latest build -p ios --profile production --auto-submit --non-interactive
```

Если `--auto-submit` не запланировался (сборка ушла, submit отказал) — после `FINISHED`:
`npx eas-cli@latest submit -p ios --id <buildId> --profile production --non-interactive`.
Статус сборки: `npx eas-cli@latest build:view <buildId> --json`; лог из `logFiles` отдаётся в brotli — `curl -s <url> | brotli -dc`.

История: 15.09.2026 — сборки 1–2 упали (TTY; лок/TypeScript), сборка 3 (0.1.0 (3), `cc0ade74`) ушла в TestFlight.

## Новая capability = новый provisioning profile = одна интерактивная сборка

Capability в entitlements (Sign in with Apple с #277, позже Push — #98) меняет
App ID, и прежний профиль к сборке не подходит: `--non-interactive` падает на
credentials. Порядок: владелец включает capability у App ID `tv.matio.app`
(developer.apple.com → Identifiers → Sign In with Apple → Save), затем —
команда «Первая сборка» выше в обычном терминале, на вопросы о capabilities и
перевыпуске профиля — «yes». Следующие сборки снова идут `--non-interactive`.
Если две capability приходят в одну неделю — одна интерактивная сборка на обе.

**Вход через Google (#277) — переменные EAS до сборки.** Кнопка Google
попадает в бинарник только с обоими id клиентов в окружении `production`
(`mobile/app.config.ts` кладёт их в `extra` и выводит URL-схему):

```
cd mobile
npx eas-cli@latest env:set --environment production --name EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID --value "<Web client id из Clerk → SSO → Google>" --visibility plaintext --scope project --non-interactive
npx eas-cli@latest env:set --environment production --name EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID --value "<iOS client id для tv.matio.app>" --visibility plaintext --scope project --non-interactive
npx eas-cli@latest env:list --environment production   # проверка
```

Id клиентов публичны (они в любом бинарнике), но в репо их нет — только EAS
env. Сами кнопки включает серверный рубильник `APP_SOCIAL_SIGNIN` в Vercel
(`docs/services.md` → Clerk), сборка для этого не нужна.

  Не запускать одновременно с тяжёлой сборкой веба на этой машине (сборка идёт
  в облаке EAS, но `prebuild` и загрузка проекта — локально).
- `ios/` и `android/` в репо не коммитятся (CNG): EAS делает `expo prebuild`
  сам из `app.json`; локальные папки после `expo run:*` игнорируются gitignore
  и в облако не уходят.
- Внешние тестеры TestFlight и подача в App Store — после App Transfer на
  аккаунт компании (или осознанно с продавцом-физлицом).

## Грабли

- **Лок мобильного обязан быть согласован для ЛЮБОГО npm, не только для локального.** Сборка 15.09 (build 2) упала в `Install dependencies`: `npm ci` на билдере EAS сказал «Missing: typescript@5.9.3 from lock file» — `typescript ~7` в `mobile/package.json` не удовлетворял peer `^5` у `@solana/codecs-*` (транзитивно из `@clerk/clerk-js`), и npm билдера хотел вложенную 5.9.3, которой в локе нет; локальный npm 11 это прощает. TypeScript мобильного держим на `~5.9` (штатный для Expo SDK 57). Проверка перед сборкой и при любом Dependabot-PR в `mobile/`: `cd mobile && npm ci && npm ls typescript` — ноль строк `invalid`.

- `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` стоит в `app.json` нарочно: без него App Store Connect требует ручной ответ про экспорт шифрования перед КАЖДЫМ тестом сборки (приложение использует только HTTPS — исключение по правилам Apple).

- **Иконка iOS — без альфа-канала**, иначе App Store отклоняет загрузку. `mobile/assets/images/icon.png` (1024, #307) сделана из веба: `sips -z 1024 1024 public/icon-512.png` (это `app/icon.png`, залитая чёрным, — пиксель в пиксель; холст `sips -j` всегда пишет альфу, поэтому из самого `app/icon.png` непрозрачный PNG без потерь не получить). Проверка после любой замены: `sips -g hasAlpha mobile/assets/images/icon.png` → `no`. Слои Android и заставка — прозрачная M, вырезанная из того же `app/icon.png` скриптом `sips -j` (текст в PR #307). Родной мастер 1024 от дизайнера — строка в `docs/registry.md`.

- Первая сборка требует живой сессии Apple ID; агенту её не отдавать —
  пароль и 2FA вводит владелец через `! …` в основной сессии.
- `--auto-submit` на первой сборке создаёт запись приложения в App Store
  Connect; название «Matio» должно быть свободно в сторе — если занято, EAS
  спросит другое, тогда `ascAppId` в `eas.json → submit.production`.
- **`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` в облачную сборку сам не попадает.**
  Локально ключ лежит в `mobile/.env.local` — gitignored, и EAS его не
  загружает; `eas.json → env` у профиля `production` пуст, а переменных
  окружения EAS (`eas env:list --environment production`) не было ни одной.
  Так собралась 0.1.0 (4): в её Hermes-бандле ключа нет (`unzip` IPA →
  `strings main.jsbundle | grep -o 'pk_live_[A-Za-z0-9=]*'` даёт только
  8-символьный литерал из кода библиотеки, а не 28-символьный ключ), Clerk в
  приложении не смонтирован, и таб Account падал (#247 — сама падучесть
  исправлена, без ключа таб теперь говорит «Sign-in unavailable», но войти в
  такой сборке нельзя). Перед сборкой в TestFlight ключ должен быть в EAS:
  `npx eas-cli@latest env:create --environment production --name
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_live_… --visibility plaintext`
  (значение — из `mobile/.env.local`; ключ публичный, он же лежит в HTML
  каждой страницы сайта), проверка — `eas env:list --environment production`.
  Секретов у приложения по-прежнему нет — только этот публичный ключ; в
  `.env` мобильного (коммитимый) ничего не класть. (`--visibility` принимает
  `plaintext` / `sensitive` / `secret` — `plain` eas-cli 24.8 отвергает.)
- **Sentry в приложении (#317) включается так же — переменной EAS, не кодом.**
  `EXPO_PUBLIC_SENTRY_DSN` в окружении `production` (команда —
  `docs/services.md` → Sentry → The app); без неё сборка просто не
  отчитывается. `eas.json` задаёт обоим профилям
  `SENTRY_DISABLE_AUTO_UPLOAD=true` — **не убирать**: плагин
  `@sentry/react-native/expo` встраивает в сборку фазы загрузки карт/dSYM, и
  без токена они роняют `eas build`. Нативный модуль Sentry — ещё одна
  причина, по которой смена `app.json` требует `expo prebuild --clean` перед
  локальной dev-сборкой.
- **Сборка, которой нужен новый роут `/v1`, ждёт релиза, который этот роут подаёт.** Приложение ходит в прод (`https://matio.tv`), а прод — это последний Release, не `main`: слитый в `main` роут до «релизь» отвечает 405/404 (так было с `GET /api/v1/progress`, #303). Порядок: релиз → `curl` нового роута на matio.tv → только потом `eas build`.
