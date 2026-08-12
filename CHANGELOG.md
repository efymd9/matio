# Changelog

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
