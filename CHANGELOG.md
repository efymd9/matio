# Changelog

## [0.18.0](https://github.com/efymd9/matio/compare/matio-v0.17.0...matio-v0.18.0) (2026-10-04)


### Features

* pnpm export-email и erase-email — доступ и стирание для адреса без аккаунта ([#339](https://github.com/efymd9/matio/issues/339)) ([#389](https://github.com/efymd9/matio/issues/389)) ([cfa0488](https://github.com/efymd9/matio/commit/cfa048829172c895680c06c3361f7fca0095699d))


### Bug fixes

* IP-фолбэк склейки триалов не привязывает строки приложения к аккаунту ([#349](https://github.com/efymd9/matio/issues/349)) ([#391](https://github.com/efymd9/matio/issues/391)) ([4640d81](https://github.com/efymd9/matio/commit/4640d8173095e5ce3bb6cae67490cb1b163ca0b6))
* безопасность — next 16.3.7 (RCE в next/og), dompurify 3.4.16, ignore braces/node-forge без фикса ([#379](https://github.com/efymd9/matio/issues/379)) ([#381](https://github.com/efymd9/matio/issues/381)) ([465c249](https://github.com/efymd9/matio/commit/465c249929b34d8601fdf94060fb171a3eaae3dd))
* вебхук Clerk — конфликт адреса в users разбирается, а не роняет user.created ([#380](https://github.com/efymd9/matio/issues/380)) ([#383](https://github.com/efymd9/matio/issues/383)) ([67424f4](https://github.com/efymd9/matio/commit/67424f455ceb28648e6ae209841d0cc51548026c))
* зависимости — ip-address 10.7.2 в pnpm-lock (ночной security, [#372](https://github.com/efymd9/matio/issues/372)) ([#373](https://github.com/efymd9/matio/issues/373)) ([6192dff](https://github.com/efymd9/matio/commit/6192dffc9a055f70b7a8ec91b729a9897f9d5ab0))
* зависимости — Sentry 11 (веб) и 8 (приложение) с сохранённым приватным контрактом, группа Dependabot ([#390](https://github.com/efymd9/matio/issues/390)) ([#393](https://github.com/efymd9/matio/issues/393)) ([4a2b7de](https://github.com/efymd9/matio/commit/4a2b7de57942115095c072df9bcd5393ebd5f3e9))
* лимитеры по хешу IP считают IPv6-клиента по /64 ([#351](https://github.com/efymd9/matio/issues/351)) ([#387](https://github.com/efymd9/matio/issues/387)) ([c7cb4d2](https://github.com/efymd9/matio/commit/c7cb4d2fcfa3d563d845146ccf616a8f3d7fb19f))
* пред-релизная проверка 0.18.0 — честное «сессия закончилась» вместо ложного удаления, pnpm -s в GDPR-скриптах, дрейф документации ([#398](https://github.com/efymd9/matio/issues/398)) ([#399](https://github.com/efymd9/matio/issues/399)) ([167e993](https://github.com/efymd9/matio/commit/167e993333c73d66270217d8692e3e047a9c44ec))
* приватность — PAY_FIRST_ALERT гостевого чекаута без адреса покупателя ([#385](https://github.com/efymd9/matio/issues/385)) ([#388](https://github.com/efymd9/matio/issues/388)) ([b795147](https://github.com/efymd9/matio/commit/b795147c2db835b2f297fc50d2a471356eb396be))
* приватность — query ссылки отписки и текст страницы больше не уходят в Sentry через спаны и contexts.nextjs ([#394](https://github.com/efymd9/matio/issues/394)) ([#395](https://github.com/efymd9/matio/issues/395)) ([d9acae4](https://github.com/efymd9/matio/commit/d9acae4c57857c44e1c67bd4d332b86cc132b845))
* приватность — параметры запросов Drizzle не уходят в Sentry и лог маршрутов токена ([#326](https://github.com/efymd9/matio/issues/326)) ([#382](https://github.com/efymd9/matio/issues/382)) ([f6a18fd](https://github.com/efymd9/matio/commit/f6a18fd3f82e9d294d02a3d3b817a4a383b6bdbe))
* стирание — поздний user.created не воскрешает удалённый аккаунт, приложение не врёт после таймаута удаления ([#336](https://github.com/efymd9/matio/issues/336)) ([#392](https://github.com/efymd9/matio/issues/392)) ([19944c4](https://github.com/efymd9/matio/commit/19944c4ce2c48e416e87103c274efa30162c135a))
* экспорт ст. 15 находит анонимные напоминания адреса в смешанном регистре ([#340](https://github.com/efymd9/matio/issues/340)) ([#384](https://github.com/efymd9/matio/issues/384)) ([3ed1221](https://github.com/efymd9/matio/commit/3ed1221a5e522a67a936f663f5d83b18f9bb1e3b))


### Documentation

* релизный ритуал — скрытый chore после сборки Release PR тоже замораживает его ветку ([#402](https://github.com/efymd9/matio/issues/402)) ([2114ea6](https://github.com/efymd9/matio/commit/2114ea6913760975233ec5e08575cbba5b54a6a0))

## [0.17.0](https://github.com/efymd9/matio/compare/matio-v0.16.1...matio-v0.17.0) (2026-09-29)


### Features

* /ideas — своя фотография фона лендинга, фокус на героине ([#370](https://github.com/efymd9/matio/issues/370)) ([#371](https://github.com/efymd9/matio/issues/371)) ([5ecd4f3](https://github.com/efymd9/matio/commit/5ecd4f3b375e8cc02baadb25d46e87c20ef48635))


### Bug fixes

* зависимости — ip-address 10.5.1 и undici 7.29.1 в pnpm-lock (ночной security, [#365](https://github.com/efymd9/matio/issues/365)) ([#366](https://github.com/efymd9/matio/issues/366)) ([2dd9561](https://github.com/efymd9/matio/commit/2dd9561fd85e801059452ce4bd8f4cb4c2bf17bc))

## [0.16.1](https://github.com/efymd9/matio/compare/matio-v0.16.0...matio-v0.16.1) (2026-09-28)


### Bug fixes

* /ideas — поле логлайна под сильным блюром, шапка уезжает со скроллом ([#362](https://github.com/efymd9/matio/issues/362)) ([#363](https://github.com/efymd9/matio/issues/363)) ([d46e12e](https://github.com/efymd9/matio/commit/d46e12ed0ec91d26eeac16a283dca88b87b17e55))

## [0.16.0](https://github.com/efymd9/matio/compare/matio-v0.15.0...matio-v0.16.0) (2026-09-28)


### Features

* лендинг /ideas — фанаты присылают идеи историй и контакты ([#297](https://github.com/efymd9/matio/issues/297)) ([#352](https://github.com/efymd9/matio/issues/352)) ([ebd81d1](https://github.com/efymd9/matio/commit/ebd81d130edf53f6da46dba026b06e155e45e831))


### Bug fixes

* «‹» в ландшафтном плеере больше не замораживает приложение ([#358](https://github.com/efymd9/matio/issues/358)) ([#361](https://github.com/efymd9/matio/issues/361)) ([44913fb](https://github.com/efymd9/matio/commit/44913fb5dd22a3801ceac1abdeae5e2805ce0192))
* «‹» горизонтального плеера уходит в чёрную полосу у края и не накрывает кнопки AVKit ([#359](https://github.com/efymd9/matio/issues/359)) ([#360](https://github.com/efymd9/matio/issues/360)) ([cec16b6](https://github.com/efymd9/matio/commit/cec16b6396236c5de4dfcad6b30260c483583ba0))
* вотчер бебиситинга не считает идущую проверку CI красной ([#353](https://github.com/efymd9/matio/issues/353)) ([#357](https://github.com/efymd9/matio/issues/357)) ([1e0a24d](https://github.com/efymd9/matio/commit/1e0a24d298527b25f0a7e90b921bf178b926ecea))


### Documentation

* DSN Sentry приложения задан в EAS — services.md и строка реестра ([#354](https://github.com/efymd9/matio/issues/354)) ([#355](https://github.com/efymd9/matio/issues/355)) ([3870fca](https://github.com/efymd9/matio/commit/3870fcaf973a619bcf7ec91bbd6124d67f394fad))

## [0.15.0](https://github.com/efymd9/matio/compare/matio-v0.14.0...matio-v0.15.0) (2026-09-27)


### Features

* мобильное — «потяни для обновления» на главной, золотой спиннер ([#313](https://github.com/efymd9/matio/issues/313)) ([#331](https://github.com/efymd9/matio/issues/331)) ([c1dbaa2](https://github.com/efymd9/matio/commit/c1dbaa2d08b54843ce415f9d6ef9463972130f85))
* мобильное — Sentry в приложении, DSN-опционально, скрабберы веба ([#317](https://github.com/efymd9/matio/issues/317)) ([#344](https://github.com/efymd9/matio/issues/344)) ([ba040c4](https://github.com/efymd9/matio/commit/ba040c4deaabc0ab5fe6c4699289f74f91989134))
* мобильное — удаление аккаунта в приложении, App Store 5.1.1(v) ([#309](https://github.com/efymd9/matio/issues/309)) ([#335](https://github.com/efymd9/matio/issues/335)) ([29eaddf](https://github.com/efymd9/matio/commit/29eaddf740bb949a0448c22142f8d7eeba8b0c80))


### Bug fixes

* playback-token больше не пишет в лог параметры упавшего запроса — только id шоу и эпизода ([#305](https://github.com/efymd9/matio/issues/305)) ([#327](https://github.com/efymd9/matio/issues/327)) ([d9aa9f2](https://github.com/efymd9/matio/commit/d9aa9f20e510579e5f7aae8179c2e200a0574a33))
* картинки — подписанные Mux-кадры мимо оптимизатора, remotePatterns только наш Blob-стор ([#306](https://github.com/efymd9/matio/issues/306)) ([#332](https://github.com/efymd9/matio/issues/332)) ([f44908d](https://github.com/efymd9/matio/commit/f44908dc85a655ebe1f30db10b6091072300ac6f))
* мобильное — «Продолжить просмотр» без чужой истории после смены аккаунта, с повтором и обновлением при возврате ([#298](https://github.com/efymd9/matio/issues/298)) ([#318](https://github.com/efymd9/matio/issues/318)) ([f9c5490](https://github.com/efymd9/matio/commit/f9c549021e597a83fe6fbe7692d779d8cd16f1e0))
* мобильное — /v1/config обновляется при возврате в приложение ([#301](https://github.com/efymd9/matio/issues/301)) ([#325](https://github.com/efymd9/matio/issues/325)) ([29e7347](https://github.com/efymd9/matio/commit/29e734749d9f39fee5b70b2740591c8d7b170a30))
* мобильное — /v1/progress чинит отсутствующую строку users, у каждого эпизода своя позиция, плеер не ждёт поиска позиции ([#303](https://github.com/efymd9/matio/issues/303)) ([#333](https://github.com/efymd9/matio/issues/333)) ([286709c](https://github.com/efymd9/matio/commit/286709c09ce847e42923dc0dce84a897590d1375))
* мобильное — ErrorBoundary на маршрутах, падение рендера не закрывает приложение ([#308](https://github.com/efymd9/matio/issues/308)) ([#337](https://github.com/efymd9/matio/issues/337)) ([9fe73e0](https://github.com/efymd9/matio/commit/9fe73e0a2b8ac66db0748e32a8be55778d4316cf))
* мобильное — иконка и заставка Matio, испанская локализация бандла, только iPhone, typecheck приложения в CI ([#307](https://github.com/efymd9/matio/issues/307)) ([#330](https://github.com/efymd9/matio/issues/330)) ([5c1480c](https://github.com/efymd9/matio/commit/5c1480c77c4d9a6385048c6bd4d4aebb9eb851c6))
* мобильное — клиент API и токен Clerk: публичные чтения без Clerk, запись трекинга не уходит анонимно, keychain за блокировкой ([#299](https://github.com/efymd9/matio/issues/299)) ([#320](https://github.com/efymd9/matio/issues/320)) ([61e745f](https://github.com/efymd9/matio/commit/61e745ff5793ad65ea8fbbc64aafb1fa14f818dc))
* мобильное — пачка доступности [#304](https://github.com/efymd9/matio/issues/304): VoiceOver, 44pt, откат чипа, наверх на главной, кэш кадров Mux ([#338](https://github.com/efymd9/matio/issues/338)) ([6202c88](https://github.com/efymd9/matio/commit/6202c88af8fcbf48f0060ddabb04bb065b537a7b))
* мобильное — плеер: ретрай предзагрузки, фон и PiP, позиция каждого эпизода, VoiceOver соседних страниц ([#302](https://github.com/efymd9/matio/issues/302)) ([#322](https://github.com/efymd9/matio/issues/322)) ([5559591](https://github.com/efymd9/matio/commit/55595913204792440782d4de05dde81d687978f2))
* мобильное — подписчик смотрит subscriber-эпизоды, решение за маршрутом токена ([#316](https://github.com/efymd9/matio/issues/316)) ([#334](https://github.com/efymd9/matio/issues/334)) ([505d6b9](https://github.com/efymd9/matio/commit/505d6b978c096514742b07a8d945a53c94c5900f))
* мобильное — страница сериала: «Только для подписчиков» вместо «Subscribe», без сгенерированного синопсиса, постер вместо пустого hero, жанры как в Browse ([#311](https://github.com/efymd9/matio/issues/311)) ([#324](https://github.com/efymd9/matio/issues/324)) ([bae59ec](https://github.com/efymd9/matio/commit/bae59ece027e3989853fe14bce927ae7e7003f2c))
* мобильное — трекинг переживает обрывы сети: сохранение прогресса и офлайн-очередь сегментов ([#300](https://github.com/efymd9/matio/issues/300)) ([#329](https://github.com/efymd9/matio/issues/329)) ([23c41e7](https://github.com/efymd9/matio/commit/23c41e7aee314c69c5d7f978e12ea55727971756))
* мобильное — три текста цвета rust проходят контраст AA ([#314](https://github.com/efymd9/matio/issues/314)) ([#345](https://github.com/efymd9/matio/issues/345)) ([5962eac](https://github.com/efymd9/matio/commit/5962eac55dceacbfa890d9003c8a46c1126e4ab1))
* мобильное — экран блокировки называет сериал, а не «Matio» ([#315](https://github.com/efymd9/matio/issues/315)) ([#328](https://github.com/efymd9/matio/issues/328)) ([ea96275](https://github.com/efymd9/matio/commit/ea962758871d2e807e0c38de0d17c7d9304a5890))
* приложение в /privacy (DRAFT) и строка об Условиях и Политике в форме входа ([#312](https://github.com/efymd9/matio/issues/312)) ([#348](https://github.com/efymd9/matio/issues/348)) ([2d95f4e](https://github.com/efymd9/matio/commit/2d95f4e4fce6ea6a3a9510588aa345d6e8fe7ee5))
* юр. страницы в приложении — только текст документа, без шапки сайта и трекеров (?embed=app) ([#310](https://github.com/efymd9/matio/issues/310)) ([#323](https://github.com/efymd9/matio/issues/323)) ([4d7ff8b](https://github.com/efymd9/matio/commit/4d7ff8b1e2adfad056aee599c6d96d4c9a7763a7))

## [0.14.0](https://github.com/efymd9/matio/compare/matio-v0.13.0...matio-v0.14.0) (2026-09-27)


### Features

* мобильное — полировка, 10 видимых правок ([#292](https://github.com/efymd9/matio/issues/292)) ([#294](https://github.com/efymd9/matio/issues/294)) ([29fe998](https://github.com/efymd9/matio/commit/29fe9983c9956d1be3b83ccf0dceceb8a9576310))


### Bug fixes

* /checkout над часовым лимитом говорит «попробуйте через час» без кнопки повтора ([#233](https://github.com/efymd9/matio/issues/233)) ([#290](https://github.com/efymd9/matio/issues/290)) ([cb20cca](https://github.com/efymd9/matio/commit/cb20cca3065a14761d3a12c346d31085f1709eef))
* PostHog больше не шлёт запрос /flags — advanced_disable_feature_flags ([#295](https://github.com/efymd9/matio/issues/295)) ([#296](https://github.com/efymd9/matio/issues/296)) ([828e241](https://github.com/efymd9/matio/commit/828e2410231296b730e9576338ea8d966ded2928))
* мобильное — полировка, 15 исправлений без видимых изменений ([#288](https://github.com/efymd9/matio/issues/288)) ([#293](https://github.com/efymd9/matio/issues/293)) ([ed2b216](https://github.com/efymd9/matio/commit/ed2b21628823fde860442043f57a50633a0f9795))


### Documentation

* dotenv 18 пишет в stderr и читает DOTENV_OVERRIDE, версия @clerk/nextjs актуализирована ([#285](https://github.com/efymd9/matio/issues/285)) ([#286](https://github.com/efymd9/matio/issues/286)) ([c479dbb](https://github.com/efymd9/matio/commit/c479dbbaf024cadffcba525bcba5726d8cb4a822))

## [0.13.0](https://github.com/efymd9/matio/compare/matio-v0.12.2...matio-v0.13.0) (2026-09-23)


### Features

* блок «The team» убран со страницы /about ([#280](https://github.com/efymd9/matio/issues/280)) ([#281](https://github.com/efymd9/matio/issues/281)) ([6f44fab](https://github.com/efymd9/matio/commit/6f44fab2bd9ebd88e96588e1b32e9b2a063e8cac))


### Documentation

* фирменные письма Clerk (вариант C) сохранены в репозитории, бесплатный брендинг Clerk задокументирован ([#276](https://github.com/efymd9/matio/issues/276)) ([#278](https://github.com/efymd9/matio/issues/278)) ([26b90a4](https://github.com/efymd9/matio/commit/26b90a489989c68d461b256a0542210bd55eeca5))

## [0.12.2](https://github.com/efymd9/matio/compare/matio-v0.12.1...matio-v0.12.2) (2026-09-22)


### Bug fixes

* ошибки, чей стек целиком из внедрённого чужого скрипта, больше не тратят квоту Sentry ([#271](https://github.com/efymd9/matio/issues/271)) ([#274](https://github.com/efymd9/matio/issues/274)) ([89c9172](https://github.com/efymd9/matio/commit/89c9172ac56572f0ba0a30f2c303f780ef918f4e))


### Documentation

* /duty — шаг «Sentry за сутки» в стартовом ритуале: каждая нерешённая issue получает решение, квота Developer 5000 ([#257](https://github.com/efymd9/matio/issues/257)) ([#272](https://github.com/efymd9/matio/issues/272)) ([80822d0](https://github.com/efymd9/matio/commit/80822d0d43a2e55946f8118a3cb78757d65ccd2c))

## [0.12.1](https://github.com/efymd9/matio/compare/matio-v0.12.0...matio-v0.12.1) (2026-09-21)


### Bug fixes

* версия Stripe API закреплена константой со стражем, no-store на всех redirect-ветках billing-portal ([#266](https://github.com/efymd9/matio/issues/266)) ([#270](https://github.com/efymd9/matio/issues/270)) ([0a7cfa9](https://github.com/efymd9/matio/commit/0a7cfa942609e6678889aa87c3c78773953a8fdf))
* заблокированные маяки Mux Data на litix.io больше не копятся в Sentry и не прячут настоящие «Failed to fetch» ([#265](https://github.com/efymd9/matio/issues/265)) ([#268](https://github.com/efymd9/matio/issues/268)) ([eeb8d80](https://github.com/efymd9/matio/commit/eeb8d80c81dfdc494087272c09ced18cafa8fb1f))
* префетч &lt;Link&gt; на /subscribe у вошедшего на paywall больше не исполняет записи в БД без клика ([#264](https://github.com/efymd9/matio/issues/264)) ([#267](https://github.com/efymd9/matio/issues/267)) ([e8f1d51](https://github.com/efymd9/matio/commit/e8f1d51965b4d7a36e0bea9727800bbd8ae40ddc))

## [0.12.0](https://github.com/efymd9/matio/compare/matio-v0.11.0...matio-v0.12.0) (2026-09-21)


### Features

* **mobile:** главная v2 — лента hero-карточек под каруселью ([#248](https://github.com/efymd9/matio/issues/248)) ([#249](https://github.com/efymd9/matio/issues/249)) ([6130094](https://github.com/efymd9/matio/commit/6130094294bcca87edc756ed30de950ad1fae1fb))
* **mobile:** нативный шелл — стеклянный таб-бар B1, карусель Home, Browse, Account, Settings ([#245](https://github.com/efymd9/matio/issues/245)) ([#246](https://github.com/efymd9/matio/issues/246)) ([36ba39c](https://github.com/efymd9/matio/commit/36ba39c5559a0b6534387eb48fe99cfba51139c4))


### Bug fixes

* **ci:** ночной security зелёный — фикстура gitleaks + 48 транзитивных уязвимостей osv закрыты, 4 в ignore с датой ([#256](https://github.com/efymd9/matio/issues/256)) ([#258](https://github.com/efymd9/matio/issues/258)) ([8344087](https://github.com/efymd9/matio/commit/83440879eb245541ffe2720cfa2cb8cd2198fbfa))
* **mobile:** ascAppId/appleTeamId в submit-профиле eas.json — неинтерактивная подача в TestFlight ([#99](https://github.com/efymd9/matio/issues/99)) ([#238](https://github.com/efymd9/matio/issues/238)) ([ab77632](https://github.com/efymd9/matio/commit/ab776320ce2f3b149910a4555378b889d8c06f1d))
* **mobile:** ITSAppUsesNonExemptEncryption=false в app.json; ранбук — eas-cli@latest и запуск вне «!» ([#99](https://github.com/efymd9/matio/issues/99)) ([#236](https://github.com/efymd9/matio/issues/236)) ([0bec968](https://github.com/efymd9/matio/commit/0bec968a11cf01f9bdb8b414ea24c3ea838ffa34))
* **mobile:** TypeScript ~5.9 вместо ~7 — лок согласован для npm билдера EAS ([#99](https://github.com/efymd9/matio/issues/99)) ([#237](https://github.com/efymd9/matio/issues/237)) ([2987be4](https://github.com/efymd9/matio/commit/2987be457b4a2dd4369bab2073f555878bd8ceb8))
* **mobile:** горизонтальный плеер играет в ландшафте на весь экран, остальные экраны — портрет ([#252](https://github.com/efymd9/matio/issues/252)) ([#255](https://github.com/efymd9/matio/issues/255)) ([200cfad](https://github.com/efymd9/matio/commit/200cfadbbc64ebf30d6ef22a7bbd929b19370c8c))
* **mobile:** таб Account не крутит спиннер вечно при недоступном Clerk — таймаут 8 с, честное состояние и Retry ([#253](https://github.com/efymd9/matio/issues/253)) ([#254](https://github.com/efymd9/matio/issues/254)) ([65e0558](https://github.com/efymd9/matio/commit/65e05584b17da4aee1c308f2d9e9785147ab863b))
* **mobile:** таб Account не падает в сборке без ключа Clerk — гейт до хуков ([#247](https://github.com/efymd9/matio/issues/247)) ([#250](https://github.com/efymd9/matio/issues/250)) ([45247ca](https://github.com/efymd9/matio/commit/45247ca49a552109dcda22bb64793296077ab0a9))
* префетч &lt;Link&gt; больше не создаёт портальные сессии Stripe и не роняет «Failed to fetch» на /subscribe у анонима ([#259](https://github.com/efymd9/matio/issues/259)) ([3f6ddb3](https://github.com/efymd9/matio/commit/3f6ddb39edecb7bdab8a9ab559fef7dfeda599dd))
* префетч &lt;Link&gt; на /subscribe в RateLimitedNotice больше не роняет «Failed to fetch» у анонима ([#260](https://github.com/efymd9/matio/issues/260)) ([891ee34](https://github.com/efymd9/matio/commit/891ee34a31a487ed8896b4d1c02727cbb1a94b6f))


### Documentation

* **mobile:** ранбук — сборка и подача одной командой, submit по id, чтение brotli-лога EAS ([#99](https://github.com/efymd9/matio/issues/99)) ([#239](https://github.com/efymd9/matio/issues/239)) ([5c7e00c](https://github.com/efymd9/matio/commit/5c7e00ccea6a59f8b7ce731908551d9c37c80e38))
* **mobile:** сборки через EAS — проект @matvei-dev/matio, профили, ранбук TestFlight ([#99](https://github.com/efymd9/matio/issues/99)) ([#234](https://github.com/efymd9/matio/issues/234)) ([b284ce2](https://github.com/efymd9/matio/commit/b284ce286af3c08bf1eef83679bc00640974a34c))
* Neon на плане Launch с 17.09 — CLAUDE.md и /devops по факту, грабля про пинг DB-страницы ([#257](https://github.com/efymd9/matio/issues/257)) ([#262](https://github.com/efymd9/matio/issues/262)) ([42cca16](https://github.com/efymd9/matio/commit/42cca16f69bbd53079a6a3fd97f7b7b0e01a9cf3))

## [0.11.0](https://github.com/efymd9/matio/compare/matio-v0.10.0...matio-v0.11.0) (2026-09-15)


### Features

* **checkout:** Apple Pay / Google Pay кнопкой прямо на paywall ([#211](https://github.com/efymd9/matio/issues/211)) ([d851db7](https://github.com/efymd9/matio/commit/d851db7aeb1f0ff2175ff76e5b88ce7fb89b99b2)), closes [#210](https://github.com/efymd9/matio/issues/210)
* **privacy:** стирание у процессоров, часть 2 — lib/erase-user.ts, PostHog person, pnpm erase-user, ранбук ст. 17 ([#180](https://github.com/efymd9/matio/issues/180)) ([#226](https://github.com/efymd9/matio/issues/226)) ([75bfe77](https://github.com/efymd9/matio/commit/75bfe7778d5a63c210f8d664c2d223d028a77131))


### Bug fixes

* **admin:** остатки throw в админских формах — номер сезона и удаление эпизода со страницы сезона ([#221](https://github.com/efymd9/matio/issues/221)) ([56e8808](https://github.com/efymd9/matio/commit/56e8808401be9e582e9934999d80c0bd236b849d))
* **checkout:** гостевой pay-first — не более одной открытой сессии на покупателя ([#224](https://github.com/efymd9/matio/issues/224)) ([#231](https://github.com/efymd9/matio/issues/231)) ([f40d779](https://github.com/efymd9/matio/commit/f40d77954f79665426416c23e35d4c735bd6af42))
* **checkout:** кошелёк на paywall — принятие Условий, честная запись согласия, аудит логов ([#216](https://github.com/efymd9/matio/issues/216)) ([f390a8c](https://github.com/efymd9/matio/commit/f390a8c2b1de1d943875f5034004f7059368ca4c))
* **checkout:** лимит на частоту создания Checkout Session у авторизованного — 10/ч на аккаунт ([#227](https://github.com/efymd9/matio/issues/227)) ([#232](https://github.com/efymd9/matio/issues/232)) ([6a794a9](https://github.com/efymd9/matio/commit/6a794a9a34f8f5545ba159243cdc8fc320d83f0e))
* **checkout:** не более одной оплачиваемой сессии на покупателя — sweep открытых сессий вместо часового ключа ([#217](https://github.com/efymd9/matio/issues/217)) ([#225](https://github.com/efymd9/matio/issues/225)) ([3acd2b4](https://github.com/efymd9/matio/commit/3acd2b4f9469eae71b69a5ef66cb22c1be9dcbb0))
* **privacy:** стирание тумбстоунит всех клиентов Stripe по адресу — customers.search до DELETE FROM users ([#223](https://github.com/efymd9/matio/issues/223)) ([#230](https://github.com/efymd9/matio/issues/230)) ([ba7d3a3](https://github.com/efymd9/matio/commit/ba7d3a39638e6c2ac281a7870ea63d9f3533057d))


### Documentation

* «Production context» и /devops — прод в платном режиме с 09.09.2026, не «free pivot» ([#229](https://github.com/efymd9/matio/issues/229)) ([759ea96](https://github.com/efymd9/matio/commit/759ea96f0625d5b8ef5174297d4cd5b7e5b3568a)), closes [#228](https://github.com/efymd9/matio/issues/228)

## [0.10.0](https://github.com/efymd9/matio/compare/matio-v0.9.2...matio-v0.10.0) (2026-09-09)


### Features

* **payments:** цена 25 $/мес со списанием сразу — вводный доллар и пробный период убраны ([#208](https://github.com/efymd9/matio/issues/208)) ([d3480b8](https://github.com/efymd9/matio/commit/d3480b8a7c69ada1eb5f0b1f5a13b2fba4030c0a)), closes [#207](https://github.com/efymd9/matio/issues/207)

## [0.9.2](https://github.com/efymd9/matio/compare/matio-v0.9.1...matio-v0.9.2) (2026-09-09)


### Bug fixes

* **watch:** убрать кнопку блокировки управления из плеера ([#205](https://github.com/efymd9/matio/issues/205)) ([587c8c6](https://github.com/efymd9/matio/commit/587c8c68e6928a0c908ee05de8219524025ae5c2)), closes [#204](https://github.com/efymd9/matio/issues/204)

## [0.9.1](https://github.com/efymd9/matio/compare/matio-v0.9.0...matio-v0.9.1) (2026-09-09)


### Bug fixes

* **checkout:** адрес возврата после оплаты — платформенные источники вместо localhost ([#203](https://github.com/efymd9/matio/issues/203)) ([d03802b](https://github.com/efymd9/matio/commit/d03802bad8365ac0f30b20fdeb7a224ca37f51a8)), closes [#202](https://github.com/efymd9/matio/issues/202)
* **staging:** открыть пути вебхуков в замке стенда — Stripe получал 401 ([#201](https://github.com/efymd9/matio/issues/201)) ([cda20db](https://github.com/efymd9/matio/commit/cda20db3acefcb9dc9972629c516925b06a56068)), closes [#200](https://github.com/efymd9/matio/issues/200)
* **watch:** тир эпизода решает и под гейтом регистрации — free играет без аккаунта ([#199](https://github.com/efymd9/matio/issues/199)) ([121c0ca](https://github.com/efymd9/matio/commit/121c0caba5356623fa3b1378bc192a06d44a0d13))


### Documentation

* **registry:** прод мигрирован — 0024 и 0025 применены перед релизом v0.9.0 ([#196](https://github.com/efymd9/matio/issues/196)) ([7bc34db](https://github.com/efymd9/matio/commit/7bc34db2bf1b4222635bf8df8167013313096a67)), closes [#188](https://github.com/efymd9/matio/issues/188)

## [0.9.0](https://github.com/efymd9/matio/compare/matio-v0.8.0...matio-v0.9.0) (2026-09-08)


### Features

* **branching:** плеер — оверлей выбора (Lab-first, 5 вариантов), префетч по кандидатам и бесшовный переход по ветке ([#190](https://github.com/efymd9/matio/issues/190)) ([e7e6e13](https://github.com/efymd9/matio/commit/e7e6e13f50f4f919477253e384ae1db5401ad927))
* **branching:** схема веток + админ-развилки + скрытие веток с публичных поверхностей ([#178](https://github.com/efymd9/matio/issues/178)) ([e6354df](https://github.com/efymd9/matio/commit/e6354dfb54e2922f9b66ef110bf67823fb8824b1))
* **mobile:** остаток фазы 1 — прогресс просмотра, continue-watching, es/en, вертикальные шоу ([#170](https://github.com/efymd9/matio/issues/170)) ([d76ef75](https://github.com/efymd9/matio/commit/d76ef75461a3ccbf6d40a637492f4def408f7ba0))
* **mobile:** фаза 2 — паритет плеера: авто-переход на пуле плееров, retention-бакеты через /api/v1/watch-segments, вертикальный фид, PiP и фоновое аудио ([#181](https://github.com/efymd9/matio/issues/181)) ([cbebad6](https://github.com/efymd9/matio/commit/cbebad6ba025ff5bc0dffe4c31b1e608c87bb55c))
* **payments:** подготовка к включению — конверсия ChatGPT по режиму, дашборд v2 в обоих режимах ([#156](https://github.com/efymd9/matio/issues/156)) ([71122c6](https://github.com/efymd9/matio/commit/71122c6473a9788ce3a127d2a65b0ccf166c3d31))
* **privacy:** ретеншен по обещаниям /privacy — ежедневный крон чистки trial_sessions / visitors / watch_days / show_reminders ([#186](https://github.com/efymd9/matio/issues/186)) ([a5697df](https://github.com/efymd9/matio/commit/a5697df2c67ae31954de385eccf8788ab336eabf))
* **privacy:** экспорт данных субъекта (ст. 15/20) — pnpm export-user-data + ранбук GDPR-запросов ([#192](https://github.com/efymd9/matio/issues/192)) ([e5d0c25](https://github.com/efymd9/matio/commit/e5d0c25ffe81cb6f8ba4f855d9c02155fc91312b))


### Bug fixes

* **admin:** занятый номер эпизода — сообщение в форме, а не «Что-то пошло не так» ([#194](https://github.com/efymd9/matio/issues/194)) ([a3d3afc](https://github.com/efymd9/matio/commit/a3d3afc6037a1accdc2bdc1e058e878052617bf8))
* **auth:** authorizedParties на clerkMiddleware — из окружения, без превью, безопасно для нативных токенов ([#174](https://github.com/efymd9/matio/issues/174)) ([de99e5a](https://github.com/efymd9/matio/commit/de99e5a245ac5ee600475cc12d1dc47419d0a96d))
* **lab:** статика UI Lab рендерится — шим `vitest` вне раннера + пост-сборочный смоук в lab:build ([#176](https://github.com/efymd9/matio/issues/176)) ([0a9f8ab](https://github.com/efymd9/matio/commit/0a9f8abf83d1ce7606871361fa6f092e4f0e082b)), closes [#78](https://github.com/efymd9/matio/issues/78)
* **privacy:** CAPI-снимок (IP/UA/_fbp/_fbc) не переживает Purchase — стирание из метаданных Stripe + разовая чистка ([#183](https://github.com/efymd9/matio/issues/183)) ([d389e7b](https://github.com/efymd9/matio/commit/d389e7b7199921afa207e42fb16c428b6182959e))
* **privacy:** вебхук Clerk user.deleted стирает аккаунт — users, каскады и show_reminders по адресу ([#171](https://github.com/efymd9/matio/issues/171)) ([79f5aee](https://github.com/efymd9/matio/commit/79f5aeec08b7bc3e858cc5916af5c5c3beaa93a7))
* **privacy:** стирание у Stripe при user.deleted — cancel_at_period_end и тумбстоун стёртых customer id ([#179](https://github.com/efymd9/matio/issues/179)) ([a546573](https://github.com/efymd9/matio/commit/a546573976a9f1bc367abe4e37d637658a918feb))
* **privacy:** хвосты ревью [#179](https://github.com/efymd9/matio/issues/179) — чеклист re-enable, лимит ретраев отмены Stripe, второй customer id ([#185](https://github.com/efymd9/matio/issues/185)) ([5e24903](https://github.com/efymd9/matio/commit/5e2490309c39e91e46a0a6d878350396ce19807b))
* **site:** хиро на главной прячет превью только по фатальной ошибке и перевыпускает истёкший токен тизера ([#173](https://github.com/efymd9/matio/issues/173)) ([1f140dd](https://github.com/efymd9/matio/commit/1f140dd215dd86ee6c8a6352621b3ad129a8acf6))


### Refactoring

* **ui:** долг дизайн-системы — цвета в пропах, тени и градиенты в токены, чек ловит все четыре пласта ([#177](https://github.com/efymd9/matio/issues/177)) ([642c136](https://github.com/efymd9/matio/commit/642c136148a345cf9179278ad3937b0bb61381c6))


### Documentation

* CRON_SECRET задан на обоих проектах Vercel, стенд проверен — строка реестра снята ([#162](https://github.com/efymd9/matio/issues/162)) ([#191](https://github.com/efymd9/matio/issues/191)) ([a47e8a5](https://github.com/efymd9/matio/commit/a47e8a5dc48db9f8c05da0f239fc1182d26800ef))
* **process:** Этап 10 плейбука — privacy/GDPR-процесс ([#166](https://github.com/efymd9/matio/issues/166)) ([665ca0e](https://github.com/efymd9/matio/commit/665ca0ee718a44531519c583b6f63d430dc9838f))
* **registry:** прод не мигрирован — 0024 и 0025 применены только на staging, применить перед релизом ([#187](https://github.com/efymd9/matio/issues/187)) ([d11db14](https://github.com/efymd9/matio/commit/d11db144f4e55db8a85bcc728c36dc27df25387b))
* стенд несёт NEXT_PUBLIC_APP_ENV и Sentry DSN — снять устаревшую строку реестра ([#175](https://github.com/efymd9/matio/issues/175)) ([5b87b6e](https://github.com/efymd9/matio/commit/5b87b6e1013e2c42da807c05ac259361e1516359))

## [0.8.0](https://github.com/efymd9/matio/compare/matio-v0.7.0...matio-v0.8.0) (2026-09-04)


### Features

* **marketing:** ChatGPT-пиксель (OpenAI oaiq) под гейтом согласия + конверсия регистрации ([#146](https://github.com/efymd9/matio/issues/146)) ([a2c3b9d](https://github.com/efymd9/matio/commit/a2c3b9d0ca272a291480f223121fcd6f26b31b22))


### Bug fixes

* **admin:** не пускать email подписчика в логи ошибок Resend ([#133](https://github.com/efymd9/matio/issues/133)) ([dffd85e](https://github.com/efymd9/matio/commit/dffd85e6c846fdad3df7239bbc66788f26a805fa)), closes [#132](https://github.com/efymd9/matio/issues/132)
* **admin:** после загрузки — явный успех и живой статус обработки ([#137](https://github.com/efymd9/matio/issues/137)) ([784e989](https://github.com/efymd9/matio/commit/784e9895ffe689bef50c98fea309866a500a3b63))
* **i18n:** английский для всех, кто не просил испанский (гео-догадка удалена) ([#140](https://github.com/efymd9/matio/issues/140)) ([fe43516](https://github.com/efymd9/matio/commit/fe43516e5d0935c81433443d9bda5e37ef3dcbe0))
* **marketing:** не сжигать флаг дедупа регистрации при отозванном согласии (Meta, PostHog) ([#148](https://github.com/efymd9/matio/issues/148)) ([710d6e7](https://github.com/efymd9/matio/commit/710d6e77e8fb9ec5a2ebab3a921c62437234ef88)), closes [#147](https://github.com/efymd9/matio/issues/147)
* **seo:** усилить граф сущности Matio=DEEP ORDINARY LTD, вычистить имя из репо ([#142](https://github.com/efymd9/matio/issues/142)) ([fce6091](https://github.com/efymd9/matio/commit/fce6091bce22d4e6ec80d7bbcc62076b22e1e5e9)), closes [#141](https://github.com/efymd9/matio/issues/141)


### Documentation

* **devops:** NEXT_PUBLIC-переменная на стенде — выкатка и проверка вшитого значения ([#149](https://github.com/efymd9/matio/issues/149)) ([61888f9](https://github.com/efymd9/matio/commit/61888f9b13a82d24c22eeeb217f37073d46af838))
* сверить CLAUDE.md с реальностью перед запуском параллельной сессии ([#138](https://github.com/efymd9/matio/issues/138)) ([e890409](https://github.com/efymd9/matio/commit/e890409d6e0651fd8c304f95c51dabd3515d6965))

## [0.7.0](https://github.com/efymd9/matio/compare/matio-v0.6.0...matio-v0.7.0) (2026-08-25)


### Features

* **api:** влить /api/v1 и Expo-приложение в main, с тестами на surface ([#101](https://github.com/efymd9/matio/issues/101)) ([f533beb](https://github.com/efymd9/matio/commit/f533beb291ab76ab68eaf09e9e9f4b7b5b39e9e0))


### Bug fixes

* **admin:** загрузка видео не сдаётся при первом обрыве связи ([#131](https://github.com/efymd9/matio/issues/131)) ([e029f29](https://github.com/efymd9/matio/commit/e029f297ee7c29a9f9431a1127d19e3ad84ec493))
* **auth:** appearance.baseTheme → theme перед бампом Clerk 7.7 ([#122](https://github.com/efymd9/matio/issues/122)) ([84f7e5d](https://github.com/efymd9/matio/commit/84f7e5d3791b39ce7d3d1f5253f46fc70c123770)), closes [#107](https://github.com/efymd9/matio/issues/107)
* **auth:** переименовать переменную оформления Clerk перед бампом 7.7 ([#113](https://github.com/efymd9/matio/issues/113)) ([b26c7f2](https://github.com/efymd9/matio/commit/b26c7f2a0a70accd36d10d33aad0bd9a83456b53)), closes [#107](https://github.com/efymd9/matio/issues/107)
* **ci:** Dependabot не трогает пакеты, которыми управляет Expo SDK ([#112](https://github.com/efymd9/matio/issues/112)) ([e4badba](https://github.com/efymd9/matio/commit/e4badba2f3d5d4e58b7644576c16b7afabef5757)), closes [#109](https://github.com/efymd9/matio/issues/109)
* **site:** не мутировать живой хиро-плеер при смене согласия на куки ([#129](https://github.com/efymd9/matio/issues/129)) ([50d7498](https://github.com/efymd9/matio/commit/50d7498ecff3c133800826aa03984bf82807bf67)), closes [#126](https://github.com/efymd9/matio/issues/126)

## [0.6.0](https://github.com/efymd9/matio/compare/matio-v0.5.0...matio-v0.6.0) (2026-08-18)


### Features

* **site:** показать contact@matio.tv на первом развороте /about и /press ([#92](https://github.com/efymd9/matio/issues/92)) ([be984c4](https://github.com/efymd9/matio/commit/be984c4ce23dad1bfb249812f4178e087f386343)), closes [#91](https://github.com/efymd9/matio/issues/91)
* **site:** редизайн /about + новая страница /press (макет Claude Design «About page v3») ([#89](https://github.com/efymd9/matio/issues/89)) ([e40cdc1](https://github.com/efymd9/matio/commit/e40cdc1be18222315f124bf4324ac26970131abf))


### Bug fixes

* **site:** email убран с первого разворота /about и /press (откат [#92](https://github.com/efymd9/matio/issues/92) ревёртом [#93](https://github.com/efymd9/matio/issues/93)) ([#94](https://github.com/efymd9/matio/issues/94)) ([6828d27](https://github.com/efymd9/matio/commit/6828d2760967d0dcc2561b22e1e973ad5dbe41ef))

## [0.5.0](https://github.com/efymd9/matio/compare/matio-v0.4.0...matio-v0.5.0) (2026-08-15)


### Features

* **legal:** смена юрлица — DEEP ORDINARY LTD на всех поверхностях ([#84](https://github.com/efymd9/matio/issues/84)) ([bbd39d3](https://github.com/efymd9/matio/commit/bbd39d3f73f329a5f64b413c752824fee44ab57d))

## [0.4.0](https://github.com/efymd9/matio/compare/matio-v0.3.0...matio-v0.4.0) (2026-08-15)


### Features

* **design:** состояние синхронизации дизайн-системы в claude.ai/design ([#80](https://github.com/efymd9/matio/issues/80)) ([f834dc6](https://github.com/efymd9/matio/commit/f834dc6a406de5bb5334e76298a1b6958b02356c))
* **observability:** Sentry with a tested privacy contract + /api/readyz ([#76](https://github.com/efymd9/matio/issues/76)) ([a43fb48](https://github.com/efymd9/matio/commit/a43fb4800baa0918127baa310c4e377b6766fe68))


### Bug fixes

* **observability:** release-метка в браузерных событиях Sentry ([#82](https://github.com/efymd9/matio/issues/82)) ([ab1aef2](https://github.com/efymd9/matio/commit/ab1aef2b57e9983b538599ae192825b3ba82e863))

## [0.3.0](https://github.com/efymd9/matio/compare/matio-v0.2.0...matio-v0.3.0) (2026-08-12)


### Features

* **ci:** выкладка прода по релизу с подтверждением владельца + сид с играющими эпизодами ([#43](https://github.com/efymd9/matio/issues/43)) ([4c4d679](https://github.com/efymd9/matio/commit/4c4d679068401d82bbf1a65c1b6e25db75c297ca))
* **infra:** замок стенда — Basic Auth по STAGING_LOCK_PASSWORD + noindex ([#63](https://github.com/efymd9/matio/issues/63)) ([03fddbe](https://github.com/efymd9/matio/commit/03fddbe79fa0162fefe7bde68752a77bc9d4f05f)), closes [#62](https://github.com/efymd9/matio/issues/62)
* **infra:** шифрованные дампы БД в Vercel Blob + ежемесячная проба восстановления ([#48](https://github.com/efymd9/matio/issues/48)) ([c89376f](https://github.com/efymd9/matio/commit/c89376fe4027ca3a6b4c897a40e16711853701f0))
* **process:** autopilot — main-session watchers, guards, worktree janitor ([#53](https://github.com/efymd9/matio/issues/53)) ([f8e82ae](https://github.com/efymd9/matio/commit/f8e82ae702e9f823f6ce726b58f093ceeea7a9a1))


### Bug fixes

* **ci:** диагностика доступа Vercel перед выкладкой ([#45](https://github.com/efymd9/matio/issues/45)) ([53a4d3c](https://github.com/efymd9/matio/commit/53a4d3cbd0bc1a6c56e9474bb06c80173ea583af))
* **ci:** релизный шлюз — в своём окружении release-production ([#44](https://github.com/efymd9/matio/issues/44)) ([1c5ed2b](https://github.com/efymd9/matio/commit/1c5ed2b1e16d5934eaccff2f7b9a849ed621c209))
* **ci:** собирает Vercel, а не раннер; быстрый смоук с автооткатом ([#47](https://github.com/efymd9/matio/issues/47)) ([0f3e1c3](https://github.com/efymd9/matio/commit/0f3e1c35395ad7a1bade06014ecfadc26cc59d69))
* **infra:** /api/healthz называет ступень по APP_ENV, а не по VERCEL_ENV ([#65](https://github.com/efymd9/matio/issues/65)) ([0253ec5](https://github.com/efymd9/matio/commit/0253ec57bca2deabd9e6acd8989ded1d64e9c9b7)), closes [#42](https://github.com/efymd9/matio/issues/42)
* **process:** pr_watcher молчит на пересчёте mergeStateStatus (UNKNOWN) ([#61](https://github.com/efymd9/matio/issues/61)) ([ba96c59](https://github.com/efymd9/matio/commit/ba96c593176681b2273bd54bd7a23a0540bdf1e3))


### Documentation

* **release:** тег называется matio-vX.Y.Z, а не vX.Y.Z ([#38](https://github.com/efymd9/matio/issues/38)) ([6abd69a](https://github.com/efymd9/matio/commit/6abd69a877bf29d8dcda356d09d879c78ee0d43d))
* двухступенчатая выкладка стала боевой — main→стенд, релиз→прод ([#64](https://github.com/efymd9/matio/issues/64)) ([4d64456](https://github.com/efymd9/matio/commit/4d644566daf5a4fe408f5a37a0f4ed7ef628fb9f))

## [0.2.0](https://github.com/efymd9/matio/compare/matio-v0.1.0...matio-v0.2.0) (2026-07-31)


### Features

* версионируемые релизы — release-please, /api/healthz, скиллы release и devops ([#32](https://github.com/efymd9/matio/issues/32)) ([4f8b3a5](https://github.com/efymd9/matio/commit/4f8b3a51311bce73b3c300f2da88b5215e1c8870))


### Bug fixes

* **deps:** Next.js 16.2.6 → 16.2.12 — закрыты 9 advisories (макс. CVSS 8.3) ([#37](https://github.com/efymd9/matio/issues/37)) ([4d72f2e](https://github.com/efymd9/matio/commit/4d72f2e6c658f96b039deb5737f50cdf1383e8a1))
