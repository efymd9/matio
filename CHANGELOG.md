# Changelog

## [0.11.0](https://github.com/efymd9/matio/compare/matio-v0.10.0...matio-v0.11.0) (2026-09-12)


### Features

* **checkout:** Apple Pay / Google Pay кнопкой прямо на paywall ([#211](https://github.com/efymd9/matio/issues/211)) ([d851db7](https://github.com/efymd9/matio/commit/d851db7aeb1f0ff2175ff76e5b88ce7fb89b99b2)), closes [#210](https://github.com/efymd9/matio/issues/210)


### Bug fixes

* **checkout:** кошелёк на paywall — принятие Условий, честная запись согласия, аудит логов ([#216](https://github.com/efymd9/matio/issues/216)) ([f390a8c](https://github.com/efymd9/matio/commit/f390a8c2b1de1d943875f5034004f7059368ca4c))

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
