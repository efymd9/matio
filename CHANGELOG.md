# Changelog

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
