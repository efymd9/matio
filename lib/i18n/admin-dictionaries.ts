// String dictionaries for the ADMIN panel only — deliberately separate
// from the public es/en system (lib/i18n/dictionaries.ts), which stays
// untouched. Russian is the admin default; English is the secondary
// locale. The `admin_locale` cookie never affects the visitor-facing
// site language.
//
// Same idiom as the public dict: both locales bundle together, functions
// carry pluralisation / interpolation, and AdminDict = typeof ru keeps
// the two shapes in lockstep. The English strings reproduce the panel's
// original hard-coded copy verbatim (including smart quotes), so the EN
// rendering is byte-identical to what shipped before this dictionary.

export type AdminLocale = "ru" | "en";

export const ADMIN_SUPPORTED_LOCALES: readonly AdminLocale[] = ["ru", "en"];
export const DEFAULT_ADMIN_LOCALE: AdminLocale = "ru";

// Russian needs three plural forms (1 сезон / 2 сезона / 5 сезонов, with
// the 11–14 exception) — the English singular/plural ternary is wrong for
// most counts, so dictionary entries pick the noun form here.
function ruPlural(
  n: number,
  [one, few, many]: [string, string, string],
): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const ru = {
  language: {
    label: "Язык",
    ru: "Русский",
    en: "English",
    switchAria: "Переключить язык админ-панели",
  },
  nav: {
    homeAria: "Главная админ-панели Matio",
    adminBadge: "Админ",
    shows: "Сериалы",
    actors: "Актёры",
    analytics: "Аналитика",
    trackedLinks: "Ссылки",
    backToApp: "← Вернуться на сайт",
  },
  actorsList: {
    eyebrow: "Каталог",
    title: "Виртуальные актёры",
    total: (n: number) => `всего ${n}`,
    newActor: "Новый актёр",
    noActorsYet: "Актёров пока нет.",
    createFirstActor: "Добавить первого актёра",
    showCount: (n: number) =>
      `${n} ${ruPlural(n, ["сериал", "сериала", "сериалов"])}`,
    edit: "Редактировать",
    delete: "Удалить",
    deleteConfirm: (name: string) =>
      `Удалить актёра «${name}»? Он исчезнет со всех страниц сериалов. Это действие необратимо.`,
  },
  actorForm: {
    identityKicker: "Основное",
    identityTitle: "Имя, slug и биография",
    nameLabel: "Имя",
    namePlaceholder: "NOVA",
    slugLabel: "Slug",
    slugHint: "строчные-латиницей-через-дефис",
    slugPlaceholder: "nova",
    taglineLabel: "Амплуа",
    taglineHint:
      "Одна строка под именем — например, архетип персонажа.",
    taglinePlaceholder: "ИИ-детектив с тёмным прошлым",
    bioLabel: "Биография",
    bioHint:
      "Показывается во всплывающей карточке на странице сериала и на странице актёра.",
    bioPlaceholder: "Пара предложений о виртуальном актёре.",
    avatarKicker: "Аватар",
    avatarTitle: "Портрет актёра",
    avatarLabel: "Аватар",
    avatarHint:
      "Квадрат 1:1 · от 512×512. Кружок в разделе актёров, попап и страница актёра.",
    createActor: "Создать актёра",
  },
  actorEdit: {
    backToActors: "Актёры",
    viewOnSite: "Открыть на сайте",
    appearsInKicker: "Появления",
    appearsInTitle: "Сериалы с этим актёром",
    noAppearances:
      "Пока не добавлен ни в один сериал. Состав настраивается на странице сериала.",
    asCharacter: (c: string) => `в роли: ${c}`,
    deleteActorDescription:
      "Удаление уберёт актёра со всех страниц сериалов. Это действие необратимо.",
    deleteConfirm: (name: string) =>
      `Удалить актёра «${name}»? Это действие необратимо.`,
    deleteThisActor: "Удалить актёра",
  },
  showsList: {
    eyebrow: "Каталог",
    title: "Сериалы",
    totalAndPublished: (total: number, published: number) =>
      `всего ${total} · опубликовано ${published}`,
    newShow: "Новый сериал",
    noShowsYet: "Сериалов пока нет.",
    createFirstShow: "Создать первый сериал",
    featured: "В hero-баннере",
    justReleased: "Только вышло",
    popular: "Популярное",
    seasonCount: (n: number) =>
      `${n} ${ruPlural(n, ["сезон", "сезона", "сезонов"])}`,
    updatedDate: (date: string) => `обновлено ${date}`,
    edit: "Редактировать",
    delete: "Удалить",
    deleteConfirm: (title: string) =>
      `Удалить «${title}»? Это действие необратимо.`,
    statusDraft: "черновик",
    statusPublished: "опубликован",
  },
  errorBoundary: {
    title: "Что-то пошло не так",
    unexpectedError: "Произошла непредвиденная ошибка.",
    tryAgain: "Повторить",
    backToAdminHome: "На главную админки",
  },
  analytics: {
    eyebrow: "Аналитика",
    heading: "Дашборд",
    rangeLast24Hours: "последние 24 часа",
    rangeLast7Days: "последние 7 дней",
    rangeLast30Days: "последние 30 дней",
    rangeLast90Days: "последние 90 дней",
    rangeAllTime: "всё время",
    rangeCustom: "произвольный период",
    rangeSelected: "выбранный период",
    touchFirst: "первое касание",
    touchLast: "последнее касание",
    granularityToken: (g: string) =>
      ({
        auto: "авто",
        hour: "по часам",
        hourly: "по часам",
        day: "по дням",
        daily: "по дням",
        week: "по неделям",
        weekly: "по неделям",
        month: "по месяцам",
        monthly: "по месяцам",
      })[g] ?? g,
    kpiSignups: "Регистрации",
    // «до оплаты» — аккаунты, созданные при pay-first покупке
    // (signup_origin='guest_checkout'), сюда не входят: они появляются в
    // момент оплаты и продублировали бы метрику «Новые подписки».
    kpiSignupsSub: (range: string) => `${range} · до оплаты`,
    kpiTrialPreviews: "Превью",
    kpiConversions: "Конверсии",
    kpiConversionsSub: "превью → оплата",
    kpiTrialToPaid: "Сессии → оплата",
    // «по дате старта» — когорта окна считается по старту сессии; конверсия
    // приходит позже (вебхук Stripe), поэтому свежие окна занижены.
    kpiSessionsSub: (converted: number | string, started: number | string) =>
      `${converted}/${started} сессий · по дате старта`,
    kpiMrr: "MRR",
    kpiCancellations: "Отмены",
    // «по дате обновления» — у строки нет canceled_at; окно считается по
    // updated_at (последнее зеркалирование вебхука), это приближение.
    kpiCancellationsSub: (range: string) => `${range} · по дате обновления`,
    kpiActiveSub: (n: number) =>
      `${n} ${ruPlural(n, ["активная подписка", "активные подписки", "активных подписок"])} × $38`,
    // "serviced" = access-granting (active/trialing/past_due) — matches the
    // filter's «С доступом» terminology; «оплачивается» would be wrong for
    // past_due rows mid-retry.
    kpiServicedSub: (n: number | string) => `${n} с доступом`,
    kpiNewSubs: "Новые подписки",
    // Сколько из новых подписок пришло через pay-first гостевую оплату
    // (signup_origin='guest_checkout'). Эти аккаунты НЕ входят в «Регистрации»
    // (создаются в момент оплаты), поэтому показываем их здесь, чтобы
    // гостевые покупки были видны на дашборде.
    kpiNewSubsGuestSub: (range: string, n: number) =>
      `${range} · ${n} ${ruPlural(n, ["гостевая оплата", "гостевые оплаты", "гостевых оплат"])}`,
    sectionAcquisitionFunnel: "Воронка привлечения",
    sectionAcquisitionFunnelHint:
      "60-сек превью · запуск → вовлечение → у пейволла → конверсия",
    funnelPreviewsStarted: "Запущено превью",
    funnelPreviewsStartedHint:
      "Уникальные пары (сессия, сериал) превью за период",
    funnelPlayed: "Воспроизведено (>0 с)",
    funnelPlayedHint: "Превью с зафиксированным воспроизведением",
    funnelReachedPaywall: "Дошли до пейволла (~55 с+)",
    funnelReachedPaywallHint: "Подошли к 60-секундному лимиту превью",
    funnelConverted: "Конвертировались в оплату",
    funnelConvertedHint: "Сессии превью, отмеченные как конвертированные",
    funnelDepthNote: (n: number | string) =>
      `Глубина превью — это последняя сохранённая позиция воспроизведения за сессию, а не суммарное время просмотра: «воспроизведено» занижает совсем короткие превью, которые не успели сохраниться. Средняя глубина ${n} с из лимита 60 с. Строки до 31.05.2026 создавались при открытии страницы (не при нажатии Play) и занижают долю «воспроизведено».`,
    sectionSubscriptions: "Подписки",
    sectionSubscriptionsHintMix: (scope: string) => `распределение · ${scope}`,
    scopeActiveOnly: "только активные",
    scopeAllStatuses: "все статусы",
    scopeAccessGranting: "только с доступом",
    sectionTrend: "Динамика",
    sectionChannelsCampaigns: (touch: string) =>
      `Каналы и кампании · ${touch}`,
    sectionChannelsCampaignsHintFirst:
      "какой канал начал взаимодействие — для сверки с Meta/Google включите последнее касание",
    sectionChannelsCampaignsHintLast:
      "чему рекламные платформы приписывают конверсию",
    sectionTrialPreviewDepth: "Глубина превью",
    sectionTrialPreviewDepthHint:
      "как далеко зрители доходят в 60-секундном превью",
    sectionSubscriberEngagement: "Вовлечённость подписчиков",
    sectionSubscriberEngagementHint:
      "watch_progress · только подписчики · за всё время",
    kpiCompletionRate: "Доля досмотров",
    kpiCompletionRateSub: (
      completed: number | string,
      total: number | string,
    ) => `${completed}/${total} досмотрено`,
    kpiAvgPctWatched: "Средний % просмотра",
    kpiSampleSize: (n: number | string) => `n=${n}`,
    kpiAvgPerViewer: "Среднее на зрителя",
    minutes: (n: number | string) => `${n} мин`,
    kpiViewersCount: (n: number) =>
      `${n} ${ruPlural(n, ["зритель", "зрителя", "зрителей"])}`,
    kpiWatchRows: "Записи просмотра",
    kpiWatchRowsSub: "точки возобновления подписчиков",
    engagementApproxNote:
      "Приблизительно — позиция возобновления на пару (подписчик, эпизод), а не суммарные минуты. Реальное время просмотра — в панели Mux ниже.",
    sectionTopShows: "Топ сериалов",
    sectionTopShowsHint:
      "время просмотра подписчиков (по позиции возобновления) · за всё время · приблизительно",
    topShowsRowSub: (viewers: number, pct: number | string) =>
      `${viewers} ${ruPlural(viewers, ["зритель", "зрителя", "зрителей"])} · ${pct}%`,
    topShowsEmpty: "Прогресс просмотра подписчиков пока не зафиксирован.",
    sectionWatchTimeMux: "Время просмотра · Mux Data",
    sectionWatchTimeMuxHint: (window: string) =>
      `реальное воспроизведение · ${window} · без hero · только зрители с согласием`,
    muxClampedNotice:
      "Mux Data ограничен 30-дневным окном — показаны последние 30 дней, хотя выбранный период шире.",
    muxNotConnectedPrefix:
      "Не подключено. Добавьте токен доступа Mux с правом",
    muxNotConnectedAs: "в переменных",
    muxNoData:
      "Подключено — просмотров в этом окне пока нет. Данные Mux появляются через несколько минут после просмотров зрителей, давших согласие.",
    muxError:
      "Mux Data сейчас недоступен — попробуйте обновить страницу через минуту.",
    kpiTotalWatchTime: "Общее время просмотра",
    hours: (n: number | string) => `${n} ч`,
    kpiViews: "Просмотры",
    kpiUniqueViewers: "Уникальные зрители",
    kpiAvgView: "Средний просмотр",
    kpiAvgViewSub: "за просмотр",
    muxByShowViews: (n: number) =>
      `${n.toLocaleString()} ${ruPlural(n, ["просмотр", "просмотра", "просмотров"])}`,
    campaignTableEmpty:
      "Нет данных по кампаниям за этот период. Размечайте посадочные URL параметрами utm_source / utm_medium / utm_campaign для атрибуции.",
    campaignSessionsNote:
      "«Сессии» включают и 60-сек превью, и бесплатные эпизоды — итог больше, чем превью-воронка выше.",
    tableColCampaign: "Кампания",
    tableColSourceMedium: "Источник / канал",
    tableColTrials: "Сессии",
    tableColSignups: "Регистрации",
    tableColSubs: "Новые подписки",
    tableColTrialToSub: "Сессии→подписка",
    tableColTrialToSubTitle:
      "Подписки за период к сессиям за период — связаны только атрибуцией, не по-сессионная когорта",
    tableColMrr: "Новый MRR",
    tableColWall: "До стены",
    tableColWallTitle:
      "Доля сессий, дошедших до пейволла превью (≥55 с), до стены регистрации или до конца бесплатных эпизодов",
    // ---- воронка эпизодов (бесплатный уровень, по сериалу) ----
    episodeFunnelTitle: (title: string) => `Воронка эпизодов · ${title}`,
    episodeFunnelHint: (free: number, member: number, range: string) =>
      `бесплатных: ${free} · по аккаунту: ${member} · ${range}`,
    efStarted: "Начали смотреть бесплатно",
    efStartedHint: "Анонимные сессии, запустившие бесплатный эпизод за период",
    efWallHit: "Дошли до стены регистрации",
    efWallHitHint: "Стена показана, или бесплатные эпизоды закончились",
    // Вариант для сериалов без эпизодов по аккаунту: после бесплатных
    // эпизодов сразу пейволл подписки (pay-first), стены регистрации нет.
    efPaywallDirect: "Дошли до пейволла подписки",
    efPaywallDirectHint:
      "Бесплатные эпизоды закончились — дальше сразу пейволл (эпизодов по аккаунту нет)",
    efSignedUp: "Получили аккаунт",
    efSignedUpHint:
      "Сессии со стены, привязанные к аккаунту. При pay-first аккаунт создаётся в момент покупки — это уже не «регистрация до оплаты»",
    efMemberWatchers: "Смотрели эпизоды по аккаунту",
    efMemberWatchersHint:
      "Привязанные пользователи с прогрессом на эпизодах по аккаунту",
    efPaywallHit: "Дошли до пейволла подписки",
    efPaywallHitHint:
      "Привязанные пользователи, досмотревшие последний эпизод по аккаунту",
    efSubscribed: "Оформили подписку",
    efSubscribedHint:
      "Сессии воронки, отмеченные конвертированными вебхуком Stripe",
    efMemberEpisodesLabel: "Эпизоды по аккаунту · привязанные пользователи",
    efCompleted: (n: number | string) => `досмотрели: ${n}`,
    efViewers: (n: number) =>
      `${n.toLocaleString()} ${ruPlural(n, ["зритель", "зрителя", "зрителей"])}`,
    efNoMemberViews: "Просмотров эпизодов по аккаунту пока нет.",
    efDepthLabel: "Глубина бесплатного уровня · сессии, дошедшие до эпизода N",
    efDepthNote:
      "Глубина — позиция самого дальнего начатого эпизода за сессию (монотонная запись), не досмотр. Привязка к аккаунту: при обычной регистрации — по trial-cookie с IP-фолбэком (может слегка завышаться в общих сетях), при pay-first покупке — только по точному токену (может занижаться, если webview потерял cookie).",
    // ---- Бесплатный режим: органическая воронка (PAYMENTS_ENABLED не задан) ----
    freeModeBadge: "бесплатный режим",
    kpiFreeSessions: "Сессии просмотра",
    // «браузеров» — уникальные trial-cookie за период (одна кука может
    // открыть несколько сериалов → сессий больше, чем браузеров).
    kpiFreeSessionsSub: (viewers: number) =>
      `${viewers.toLocaleString()} ${ruPlural(viewers, ["браузер", "браузера", "браузеров"])}`,
    kpiPlayed: "Начали смотреть",
    kpiPctOfSessions: (pct: number | string) => `${pct}% сессий`,
    kpiEngaged2: "2+ эпизода",
    kpiAvgDepth: "Эпизодов за сессию",
    kpiAvgDepthSub: "среди начавших смотреть",
    sectionOrganicFunnel: "Органическая воронка",
    sectionOrganicFunnelHint:
      "анонимные сессии просмотра за период · без стен и оплат",
    ofSessions: "Сессии",
    ofSessionsHint:
      "Строка trial_sessions (браузер × сериал), создаётся при старте плеера",
    ofPlayed: "Начали смотреть",
    ofPlayedHint: "Есть сохранённая позиция — кадры реально рендерились",
    ofEngaged2: "Дошли до 2-го эпизода",
    ofEngaged2Hint: "Самый дальний начатый эпизод ≥ 2",
    ofEngaged3: "Дошли до 3-го эпизода",
    ofEngaged3Hint: "Самый дальний начатый эпизод ≥ 3",
    organicDepthNote: (avg: number | string) =>
      `В среднем ${avg} эп. на сессию среди начавших смотреть. Число сессий — нижняя граница: лимит 10 минтов на (IP, сериал) в час молча отбрасывает трекинг в горячих сетях (CGNAT, webview), а до согласия на cookies в ЕС метки не пишутся.`,
    sectionSources: "Источники трафика",
    sourcesBySourceLabel: "Сессии по источникам",
    sourcesEmpty:
      "Размеченного трафика пока нет — создайте отслеживаемую ссылку и поделитесь ею.",
    sourceSessionsCount: (n: number) =>
      `${n.toLocaleString()} ${ruPlural(n, ["сессия", "сессии", "сессий"])}`,
    sourceRowSub: (viewers: number) =>
      `${viewers.toLocaleString()} ${ruPlural(viewers, ["браузер", "браузера", "браузеров"])}`,
    tableColSessions: "Сессии",
    tableColPlayedPct: "Начали",
    tableColAvgEps: "Эп./сессия",
    tableColDeepPct: "2+ эп.",
    campaignFreeNote:
      "Сессии — анонимные сессии просмотра с выбранной моделью атрибуции; «(direct)» — без UTM-меток (органика, вводы вручную и клики до согласия на cookies в ЕС). Регистрации — аккаунты, чьё касание по выбранной модели совпало с кампанией.",
    sectionTrackedLinks: "Отслеживаемые ссылки",
    sectionTrackedLinksHint: "по первому касанию · за выбранный период",
    trackedLinksManage: "Управлять ссылками →",
    trackedLinksEmpty:
      "Ссылок пока нет. Создайте первую в разделе «Ссылки» — и делитесь ею в соцсетях.",
    tlColName: "Ссылка",
    tlColTarget: "Куда ведёт",
    tlColSessions: "Сессии",
    tlColPlayed: "Начали",
    tlColSignups: "Регистрации",
    tlColAllTime: "Всё время",
    showDepthTitle: (title: string) => `Глубина · ${title}`,
    showDepthHint: (started: number, range: string) =>
      `${started.toLocaleString()} ${ruPlural(started, ["сессия", "сессии", "сессий"])} · ${range}`,
    showDepthPlayed: (n: number | string) => `начали смотреть: ${n}`,
    showDepthBarsNote:
      "Сессии, дошедшие до эпизода N (кумулятивно, по самому дальнему начатому эпизоду).",
    sectionSignedInEngagement: "Вовлечённость · вошедшие зрители",
    sectionSignedInEngagementHint:
      "watch_progress: зрители с аккаунтом (в бесплатном режиме — любой вошедший) · всё время",
    // ---- Воронка регистраций (REQUIRE_SIGNUP: анонимный просмотр закрыт,
    // верх воронки живёт только в PostHog) ----
    sectionSignupFunnel: "Воронка регистраций",
    signupFunnelHint: "весь сайт · только период — фильтры не применяются",
    sfVisitors: "Посетители",
    sfVisitorsHint: "Уникальные посетители по PostHog ($pageview)",
    sfWall: "Увидели стену регистрации",
    sfWallHint: "Событие signup_wall_shown (PostHog), уникальные посетители",
    sfSignups: "Зарегистрировались",
    sfSignupsHint: "Аккаунты за период (clerk_signup) — из нашей БД",
    sfWatching: "Начали смотреть после регистрации",
    sfWatchingHint:
      "Из зарегистрировавшихся за период — сохранили прогресс просмотра (watch_progress, БД)",
    sfBySourceLabel: "Посетители по источникам (PostHog)",
    sfBySourceEmpty: "Нет просмотров страниц за период.",
    sfSourceRowSub: (wall: number) =>
      `стену увидели: ${wall.toLocaleString()}`,
    sfVisitorsCount: (n: number) =>
      `${n.toLocaleString()} ${ruPlural(n, ["посетитель", "посетителя", "посетителей"])}`,
    sfConsentNote:
      "«Посетители» и «Стена» — персоны PostHog: считаются только браузеры с согласием на маркетинговые cookies (вне ЕС оно включено по умолчанию), поэтому это нижняя граница. «Зарегистрировались» и «Смотрели» — данные из нашей БД.",
    sfNotConnected1:
      "Панель не подключена. Создайте в PostHog personal API key со scope",
    sfNotConnected2: "и задайте",
    sfError: "Не удалось получить данные PostHog.",
    ofGateNote:
      "С 16.07.2026 включена обязательная регистрация (REQUIRE_SIGNUP): анонимные сессии больше не создаются, и эта воронка не пополняется. Живой верх воронки — в «Воронке регистраций» выше.",
  },
  showNew: {
    backToShows: "Сериалы",
    eyebrow: "Новый сериал",
    heading: "Создать сериал",
    subheading: "Сезоны и эпизоды можно добавить после создания.",
  },
  showEdit: {
    backToShows: "Сериалы",
    viewOnSite: "Открыть на сайте",
    homeHeroKicker: "Hero на главной",
    featuredShowTitle: "Сериал в hero-баннере",
    heroCurrentDescription:
      "Этот сериал сейчас в hero-баннере на главной. Одновременно в hero может быть только один сериал.",
    removeFromHero: "Убрать из hero",
    heroPromoteDescription:
      "Поместить этот сериал в hero-баннер на главной. Текущий hero-сериал будет убран.",
    heroPublishFirstDescription:
      "Сначала опубликуйте сериал — в hero попадают только опубликованные.",
    featureOnHome: "Поставить в hero",
    contentKicker: "Контент",
    seasonsTitle: "Сезоны",
    seasonCount: (n: number) =>
      `${n} ${ruPlural(n, ["сезон", "сезона", "сезонов"])}`,
    noSeasonsEmptyState: "Сезонов пока нет. Добавьте первый ниже.",
    seasonLabel: (n: number) => `Сезон ${n}`,
    episodes: "Эпизоды",
    deleteSeasonConfirm: (n: number) =>
      `Удалить сезон ${n}? Все его эпизоды тоже будут удалены.`,
    delete: "Удалить",
    seasonNumberPlaceholder: "#",
    seasonNumberAria: "Номер сезона",
    seasonTitlePlaceholder: "Название (необязательно)",
    seasonTitleAria: "Название сезона",
    add: "Добавить",
    dangerZone: "Опасная зона",
    deleteShowDescription:
      "Удаление убирает сериал из каталога. Вместе с ним удаляются сезоны и эпизоды.",
    deleteShowConfirm: (title: string) =>
      `Удалить «${title}»? Это действие необратимо.`,
    deleteThisShow: "Удалить сериал",
    statusDraft: "черновик",
    statusPublished: "опубликован",
    featured: "В hero-баннере",
    castKicker: "Состав",
    castTitle: "Виртуальные актёры",
    castCount: (n: number) =>
      `${n} ${ruPlural(n, ["актёр", "актёра", "актёров"])}`,
    noCastYet: "Актёры пока не добавлены. Добавьте первого ниже.",
    characterPlaceholder: "Роль (необязательно)",
    characterAria: (name: string) => `Роль актёра ${name} в этом сериале`,
    characterAddAria: "Роль в этом сериале",
    saveCharacter: "Сохранить",
    moveUpAria: (name: string) => `Поднять ${name} выше в списке`,
    moveDownAria: (name: string) => `Опустить ${name} ниже в списке`,
    removeCastConfirm: (name: string) =>
      `Убрать «${name}» из состава этого сериала? Сам актёр не удаляется.`,
    removeFromCast: "Убрать",
    addToCast: "Добавить",
    selectActorAria: "Выберите актёра",
    selectActorPlaceholder: "— актёр —",
    allActorsAdded: "Все существующие актёры уже в составе.",
    noActorsExistHint: "Актёров пока нет — сначала создайте их.",
    manageActorsLink: "Управление актёрами →",
  },
  season: {
    seasonN: (n: number) => `Сезон ${n}`,
    episodeCountReady: (count: number, ready: number) =>
      `${count} ${ruPlural(count, ["эпизод", "эпизода", "эпизодов"])} · ${ready} готово`,
    panelKickerContent: "Контент",
    panelTitleEpisodes: "Эпизоды",
    emptyEpisodes: "Эпизодов пока нет. Добавьте первый ниже.",
    edit: "Редактировать",
    deleteEpisodeConfirm: (number: number, title: string) =>
      `Удалить эпизод ${number} «${title}»? Это действие необратимо.`,
    delete: "Удалить",
    addAnEpisode: "Новый эпизод",
    fieldNumber: "Номер",
    fieldTitle: "Название",
    episodeTitlePlaceholder: "Название эпизода",
    fieldDescription: "Описание",
    descriptionPlaceholder: "Краткое описание (необязательно).",
    addEpisodeButton: "Добавить эпизод",
  },
  episode: {
    backLabelSeason: (showTitle: string, n: number) =>
      `${showTitle} · Сезон ${n}`,
    kickerSeasonEpisode: (s: number, e: number) =>
      `Сезон ${s} · Эпизод ${e}`,
    videoKicker: "Видео",
    replaceVideo: "Заменить видео",
    uploadVideo: "Загрузить видео",
    videoUploadHint:
      "Файлы загружаются напрямую в Mux. После загрузки Mux транскодирует видео, и статус автоматически меняется на «Готово».",
    noPreviewYet: "Превью пока нет",
    noVideo: "Нет видео",
    metaStatus: "Статус",
    metaDuration: "Длительность",
    metaAssetId: "Asset ID",
    metaPlaybackId: "Playback ID",
    detailsKicker: "Сведения",
    episodeInfo: "Информация об эпизоде",
    fieldNumber: "Номер",
    fieldTitle: "Название",
    fieldDescription: "Описание",
    skipIntro: "Пропуск заставки",
    skipIntroBlankHint: "Оставьте оба поля пустыми, чтобы скрыть кнопку",
    fieldStart: "Начало",
    fieldEnd: "Конец",
    secondsHint: "секунды",
    skipIntroPlaceholderStart: "напр. 5",
    skipIntroPlaceholderEnd: "напр. 60",
    introRangeError: "«Конец» должен быть больше «Начала».",
    skipIntroExplain:
      "Пока воспроизведение в этом промежутке, плеер показывает кнопку «Пропустить заставку», а по нажатию перематывает к точке «Конец».",
    savingPending: "Сохранение…",
    saveChanges: "Сохранить изменения",
    deleteDescription:
      "Удаление сотрёт эпизод и привязку к видео. Это действие необратимо.",
    deleteConfirm: (n: number, title: string) =>
      `Удалить эпизод ${n} «${title}»? Это действие необратимо.`,
    deleteThisEpisode: "Удалить этот эпизод",
  },
  // Спецификация «Аналитика» 18.07.2026 — free-mode дашборд: «цепляет ли
  // контент настолько, что люди возвращаются?». Собственный first-party
  // счётчик (matio_aid) + леджеры просмотров.
  analyticsSpec: {
    eyebrow: "Аналитика",
    heading: "Возвращаются ли зрители",
    ledgerNote:
      "Визиты, гео и источники считаются собственным счётчиком (без сторонних сервисов); данные копятся с момента деплоя панели — старые периоды пустые.",
    na: "—",
    freshNote: "Данных за период пока нет — леджер наполняется с деплоя.",
    // фильтры
    filterCustom: "Свой",
    filterFrom: "с",
    filterTo: "по",
    filterSource: "Источник",
    filterAllSources: "Все источники",
    filterCountry: "Страна",
    filterAllCountries: "Все страны",
    filterWindow: "окно «живости»",
    // KPI
    kpiVisits: "Визиты",
    kpiRegistrations: "Регистрации",
    kpiConversion: (pct: string) => `${pct} из визитов`,
    kpiNorthStar: "Глубокий досмотр ≥80%",
    kpiNorthStarSub: (deep: number, total: number) =>
      `${deep} из ${total} новых`,
    kpiReleaseRetention: "Release retention",
    kpiReleaseRetentionSub: (ret: number, fin: number) =>
      `${ret} из ${fin} досмотревших`,
    // блок 2 — пульс
    sectionPulse: "Пульс проекта",
    pulseHint: (w: number) =>
      `живая аудитория = уникальные зрители за скользящие ${w} дней`,
    pulseNetWeek: (added: number, lost: number) =>
      `за неделю (+${added} новых · −${lost} потерянных)`,
    pulseWau: (w: number) => `Живая аудитория (${w}д)`,
    pulseNew: "Новые",
    pulseReturning: "Вернувшиеся",
    pulseLost: "Потерянные",
    pulseRelease: "Релиз",
    // блок 3 — воронка
    sectionFunnel: "Полная воронка",
    funnelHint: "когорта: посетители, впервые пришедшие в период",
    fVisited: "Зашли на сайт",
    fVisitedHint: (home: number) => `из них на главную: ${home}`,
    fShow: "Перешли к сериалу",
    fWall: "Упёрлись в рег-гейт",
    fRegistered: "Зарегистрировались",
    fStarted: "Начали эпизод",
    f25: "Досмотрели 25%",
    f50: "Досмотрели 50%",
    f80: "Досмотрели 80%",
    f100: "Досмотрели до конца",
    // блок 4 — гео
    sectionGeo: "География",
    geoHint: "не «откуда трафик», а какие страны реально смотрят",
    geoEmpty: "Регистраций за период пока нет",
    geoUnknown: "Не определена",
    geoMapValue: (n: number) => `регистраций: ${n}`,
    thCountry: "Страна",
    thVisits: "Визиты",
    thConversion: "Конв. в рег.",
    thCompletion: "Completion",
    thReleaseRet: "Release ret.",
    // блок 5 — матрица
    sectionMatrix: "Источники × гео",
    matrixHint: "качество, не объёмы",
    thSource: "Источник",
    sourceOther: "Прочее",
    matrixCellTitle: (visits: number, regs: number) =>
      `визитов: ${visits}, регистраций: ${regs}`,
    matrixCellHint:
      "в ячейке: конверсия в регистрацию · глубокий досмотр (≥80% первого эпизода); подсветка — по досмотру",
    // блок 6 — контент
    sectionContent: "Контент: эпизоды и удержание",
    contentHint: "старты и досмотры — по зарегистрированным зрителям",
    widgetAvgPerDay: "Ср. просмотр на зрителя в день",
    widgetTotal: "Всего часов просмотра",
    widgetViewerDays: "Зрителе-дней",
    hoursSuffix: "ч",
    thEpisode: "Эпизод",
    thStarts: "Старты",
    thCompletionRate: "Completion",
    thAvgWatched: "Ср. % досмотра",
    thRewatches: "Пересмотры",
    curveTitle: (label: string) => `Кривая удержания — ${label}`,
    curveYAxis: "% от начавших",
    curveViews: "просмотров",
    curveNoData:
      "Кривая появится после первых просмотров — посекундный трекинг включён с деплоя панели.",
    durationPlotTitle: "Досмотр × длина эпизода",
    // блок 7 — release retention
    sectionRelease: "Release retention по сериалам",
    releaseHint: "досмотрели эп. N → начали эп. N+1 за 7 дней после релиза",
    releaseEmpty:
      "Заполнится, когда у сериала будет ≥2 вышедших эпизода и первые досмотры.",
  },
  analyticsSessions: {
    eyebrow: "Аналитика",
    heading: "Сессии",
    subtitle: "Лента событий по каждому визиту",
    tabOverview: "Обзор",
    tabSessions: "Сессии",
    coverageNote:
      "Источник — PostHog: видны только визиты с согласием на куки (EU до баннера и часть трафика с блокировщиками сюда не попадают). Время — UTC.",
    listTitle: "Сессии",
    sessionsCount: (n: number) =>
      `${n} ${ruPlural(n, ["сессия", "сессии", "сессий"])}`,
    notConfiguredTitle: "PostHog не подключён",
    notConfiguredBody:
      "Страница читает сессии через HogQL API. Задайте POSTHOG_PERSONAL_API_KEY (personal API key со scope query:read) и POSTHOG_PROJECT_ID в окружении и передеплойте.",
    loadError: "Не удалось загрузить сессии из PostHog",
    empty: "Сессий за период нет",
    anonymous: "Аноним",
    direct: "Прямой заход",
    eventsCount: (n: number) =>
      `${n} ${ruPlural(n, ["событие", "события", "событий"])}`,
    durationSec: (n: number) => `${n} сек`,
    durationMin: (n: number) => `${n} мин`,
    timeAgoNow: "только что",
    timeAgoMin: (n: number) => `${n} мин назад`,
    timeAgoHr: (n: number) => `${n} ч назад`,
    timeAgoDay: (n: number) => `${n} дн назад`,
    endedOn: (path: string) => `Завершено на ${path}`,
    replay: "Запись сессии ↗",
    showMore: "Показать ещё",
    moreEvents: (n: number) =>
      `ещё ${n} ${ruPlural(n, ["событие", "события", "событий"])} скрыто`,
    epShort: (n: number) => `эп. ${n}`,
    // Типы событий таймлайна (ключ = имя события PostHog).
    eventLabels: {
      $pageview: "открыл(а) страницу",
      $pageleave: "закрыл(а) страницу",
      show_viewed: "страница сериала",
      trial_play_started: "началось превью",
      free_episode_started: "включил(а) эпизод",
      member_episode_started: "включил(а) эпизод",
      play_attempted: "нажал(а) play",
      first_frame: "пошло видео",
      playback_failed: "ошибка воспроизведения",
      episode_auto_advanced: "автопереход к следующему эпизоду",
      signup_wall_shown: "увидел(а) стену регистрации",
      paywall_shown: "увидел(а) пейволл",
      signup_cta_clicked: "клик по кнопке регистрации",
      signup_completed: "зарегистрировался(-ась)",
      checkout_started: "начал(а) оплату",
      subscribe_succeeded: "оформил(а) подписку",
      welcome_signin_succeeded: "вошёл(а) после оплаты",
      welcome_signin_failed: "не смог(ла) войти после оплаты",
      welcome_fallback_shown: "показан резервный вход",
    },
  },
  analyticsFilters: {
    presetAll: "Все",
    customPreset: "Свой",
    granularityAuto: "Авто",
    granularityHourly: "По часам",
    granularityDaily: "По дням",
    granularityWeekly: "По неделям",
    granularityMonthly: "По месяцам",
    fromDateAria: "Дата начала",
    toDateAria: "Дата окончания",
    intervalLabel: "Интервал",
    showLabel: "Сериал",
    allShows: "Все сериалы",
    channelLabel: "Канал",
    allChannels: "Все каналы",
    campaignLabel: "Кампания",
    allCampaigns: "Все кампании",
    subsLabel: "Подписки",
    statusAccessGranting: "С доступом",
    statusActiveOnly: "Только активные",
    statusAll: "Все статусы",
    firstTouch: "Первое касание",
    lastTouch: "Последнее касание",
    reset: "Сбросить",
  },
  charts: {
    approxBadge: "ПРИБЛ.",
    approxTooltip:
      "Приблизительно — по последней сохранённой позиции воспроизведения, а не суммарному времени просмотра",
    noChange: "без изменений",
    newDelta: "с нуля",
    vsPreviousPeriod: (prev: number | string) =>
      `к предыдущему периоду (${prev})`,
    noDataYet: "Пока нет данных.",
    ofPrev: (pct: string) => `${pct} от пред. шага`,
    noSubscriptionsYet: "Подписок пока нет.",
    subs: "подписок",
  },
  formSubmit: {
    savingDefault: "Сохранение…",
  },
  imageUpload: {
    notAnImage: "Это не похоже на файл изображения.",
    uploadFailed: "Не удалось загрузить",
    altPreview: (label: string) => `${label} — превью`,
    dropOrClickToReplace: "Перетащите или нажмите, чтобы заменить",
    couldntLoadUrl: "Не удалось загрузить этот URL",
    dropImage: "Перетащите изображение",
    orBrowse: "или выберите файл",
    formatHint: "PNG, JPG, WebP · загрузка в Blob",
    uploadingPercent: (percent: string) => `Загрузка · ${percent}%`,
    urlPlaceholder: "/shows/my-show-poster.png — или перетащите файл выше",
    dismiss: "Закрыть",
  },
  showForm: {
    identityKicker: "Основное",
    identityTitle: "Название, slug и описание",
    titleLabel: "Название",
    titlePlaceholder: "QUÉDATE CONMIGO",
    slugLabel: "Slug",
    slugHint: "строчные-латиницей-через-дефис",
    slugPlaceholder: "quedate-conmigo",
    descriptionLabel: "Описание",
    descriptionPlaceholder: "Одно-два предложения, которые продают сериал.",
    genreLabel: "Жанр",
    genreHint: "Через запятую. Показываются тегами в каталоге.",
    genrePlaceholder: "romance, thriller, drama",
    artworkKicker: "Обложки",
    artworkTitle: "Постер и hero",
    artworkHint:
      "Перетащите файл для загрузки — превью показывает точный кадр, который отрисует сайт.",
    posterLabel: "Постер",
    posterHint: "Портрет 2:3 · 1024×1536. Карточки каталога + запасной OG.",
    heroLabel: "Hero",
    heroHint:
      "Широкий ≈21:9 · 2560×1080, без впечатанного названия. Страница сериала + hero на главной. Ключевые объекты — в центральных 60%.",
    visibilityKicker: "Видимость",
    visibilityTitle: "Статус и размещение",
    statusLabel: "Статус",
    statusHint: "Черновики скрыты из публичного каталога.",
    orientationLabel: "Формат видео",
    orientationHint:
      "Вертикальный включает плеер в стиле TikTok на телефонах. На десктопе вид не меняется.",
    homepageRowsLabel: "Ряды на главной",
    homepageRowsHint:
      "В каких рядах на главной появляется этот сериал. Может быть в обоих, в одном или ни в одном (страница всё равно доступна по URL).",
    justReleasedLabel: "Только вышло",
    popularNowLabel: "Популярное сейчас",
    unsavedChanges: "Несохранённые изменения",
    allChangesSaved: "Все изменения сохранены",
    cancel: "Отмена",
    saving: "Сохранение…",
    createShow: "Создать сериал",
    saveChanges: "Сохранить изменения",
  },
  // Копия для типизированных кодов ошибок AdminFormState (createShow /
  // updateShow / createActor / updateActor в app/admin/actions.ts) — тот же
  // приём, что и links.err*: понятная ошибка в форме вместо общей страницы
  // «Что-то пошло не так».
  formErrors: {
    titleRequired: "Укажите название.",
    nameRequired: "Укажите имя.",
    slugRequired: "Укажите slug.",
    slugInvalid:
      "Slug — только строчные латинские буквы, цифры и дефисы.",
    slugTaken: "Такой slug уже занят — выберите другой.",
    unknown: "Не удалось сохранить. Попробуйте ещё раз.",
    notSaved: "Не сохранено",
  },
  statusSelect: {
    draft: "Черновик",
    published: "Опубликован",
  },
  orientationSelect: {
    horizontal: "Горизонтальный (16:9)",
    vertical: "Вертикальный (9:16)",
  },
  accessSelect: {
    free: "Бесплатно",
    member: "С аккаунтом",
    subscriber: "По подписке",
    whoCanWatch: "Кто может смотреть",
    whoCanWatchHint:
      "Бесплатно — все, без аккаунта. С аккаунтом — любой вошедший пользователь. По подписке — только платные подписчики.",
  },
  timeSeriesChart: {
    metricTrials: "Превью",
    metricFree: "Бесплатные",
    // Ярлык той же метрики kind='episodes' в бесплатном режиме — там это
    // просто «сессии», слова «бесплатные» и «превью» не несут смысла.
    metricSessions: "Сессии",
    metricSignups: "Регистрации",
    metricConversions: "Конверсии",
    metricNewSubs: "Новые подписки",
    total: (n: number | string) => `всего ${n}`,
    noData: "Нет данных за этот период.",
    peak: (n: number | string) => `пик ${n}`,
  },
  uploadWidget: {
    invalidVideoFile: "Это не похоже на видеофайл.",
    failedToStartUpload: "Не удалось начать загрузку",
    uploadFailed: "Загрузка не удалась",
    uploadFinishedButMarkFailed:
      "Загрузка завершена, но сервер не смог отметить эпизод как обрабатываемый",
    dropVideoPrefix: "Перетащите видео сюда или ",
    browse: "выберите файл",
    acceptedFormatsHint:
      "MP4, MOV или любой видеофайл · загружается напрямую в Mux",
    uploadedBadge: "Загружено",
    remove: "Убрать",
    preparingUpload: "Подготовка загрузки…",
    uploadingProgress: (percent: string) => `Загрузка · ${percent}%`,
    transcodingNotice: "Транскодирование на Mux — страница обновится сама",
    startUpload: "Начать загрузку",
    dismiss: "Закрыть",
  },
  adminUi: {
    dangerZone: "Опасная зона",
    noVideo: "Нет видео",
    ready: "Готово",
    error: "Ошибка",
    processing: "Обработка",
  },
  links: {
    eyebrow: "Маркетинг",
    heading: "Отслеживаемые ссылки",
    sub: "Ссылки с UTM-метками для соцсетей: дашборд покажет, откуда пришли зрители и как глубоко они смотрят.",
    formKicker: "Новая ссылка",
    formTitle: "Сгенерировать ссылку",
    nameLabel: "Название",
    namePlaceholder: "Июльский рил в IG",
    nameHint: "Видно только в админке — в саму ссылку не попадает.",
    targetLabel: "Куда ведёт",
    targetHome: "Главная страница",
    targetWatch: (title: string) => `Плеер — ${title}`,
    targetShow: (title: string) => `Страница сериала — ${title}`,
    targetCustom: "Свой путь…",
    customPathLabel: "Путь",
    customPathPlaceholder: "/watch/moy-serial",
    customPathHint:
      "Начинается с «/», без ?, # и домена — метки добавятся автоматически.",
    sourceLabel: "Источник · utm_source",
    sourceCustom: "Другой…",
    sourceCustomPlaceholder: "pinterest",
    mediumLabel: "Канал · utm_medium",
    mediumHint: "«social» — органика в соцсетях, «paid» — платная реклама.",
    campaignLabel: "Кампания · utm_campaign",
    campaignPlaceholder: "ig-reel-0715",
    campaignHint:
      "Уникальное имя на пост или размещение — так виден вклад каждого.",
    aliasNote:
      "Значения приводятся к канону автоматически: строчные, только [a-z0-9_-]; instagram → ig, facebook и meta → fb.",
    previewLabel: "Ссылка получится такой",
    // Подставляется в copyAria как имя ссылки для кнопки под предпросмотром.
    previewCopyName: "предпросмотр",
    submit: "Создать ссылку",
    submitPending: "Создаём…",
    createdOk: "Ссылка создана — скопируйте её из таблицы ниже.",
    errNameRequired: "Укажите название.",
    errTargetInvalid:
      "Путь должен начинаться с «/» и не содержать ?, # или домен.",
    errUtmRequired:
      "Источник, канал и кампания обязательны — и не должны быть пустыми после нормализации.",
    errDuplicate:
      "Активная ссылка с такой комбинацией source · medium · campaign уже есть — дайте кампании другое имя.",
    errShowNotFound: "Сериал не найден.",
    errUnknown: "Не получилось создать ссылку. Попробуйте ещё раз.",
    tableKicker: "Ссылки",
    tableTitle: "Все ссылки",
    tableHint:
      "Сессии — по первому касанию: браузеры, чей первый размеченный визит пришёл с меток ссылки.",
    colName: "Название",
    colTarget: "Куда ведёт",
    colSessions30: "Сессии · 30 дн.",
    colPlayed: "Начали",
    colSignups: "Регистрации",
    colAllTime: "Всё время",
    colCreated: "Создана",
    copy: "Копировать",
    copied: "Скопировано",
    copyAria: (name: string) => `Скопировать ссылку «${name}»`,
    archive: "В архив",
    archiveConfirm: (name: string) =>
      `Убрать «${name}» в архив? Сессии по её меткам останутся в аналитике; комбинацию меток можно будет использовать снова.`,
    empty: "Ссылок пока нет — создайте первую выше.",
    consentNote:
      "В ЕС метки пишутся только после согласия на cookies, поэтому часть кликов оседает в «(direct)». Вне ЕС метки пишутся с первого визита.",
  },
  reminders: {
    kicker: "Рассылка",
    title: "Напоминания о новых эпизодах",
    pendingBadge: (n: number) =>
      `${n} ${ruPlural(n, ["адрес ждёт", "адреса ждут", "адресов ждут"])}`,
    description:
      "Зрители, оставившие почту после финала. Выберите вышедший эпизод — каждому уйдёт письмо со ссылкой на него.",
    episodeAria: "Эпизод для рассылки",
    episodeOption: (s: number, e: number, title: string | null) =>
      `S${s} · E${e}${title ? ` — ${title}` : ""}`,
    confirmSend: (n: number) =>
      `Отправить письмо ${n} ${ruPlural(n, ["адресу", "адресам", "адресам"])}?`,
    sendCta: "Отправить",
    sendPending: "Отправляем…",
    sentOk: (n: number) =>
      `Отправлено ${n} ${ruPlural(n, ["письмо", "письма", "писем"])}.`,
    noPending:
      "Пока никто не ждёт письма. Форма показывается зрителям после финального эпизода сериала.",
    sentSoFar: (n: number) => `Всего отправлено: ${n}`,
    notConfigured:
      "Resend не подключён — задайте RESEND_API_KEY, чтобы отправлять письма. Адреса при этом продолжают сохраняться.",
    publishFirst:
      "Сначала опубликуйте сериал — письмо ведёт на публичную страницу просмотра.",
    noEpisodes: "Нет готовых эпизодов для рассылки.",
    errorEpisodeInvalid: "Эпизод не найден или ещё не готов.",
    errorNoPending: "Нет адресов, ожидающих письма.",
    errorSendFailed:
      "Resend вернул ошибку — часть писем могла не уйти. Проверьте дашборд Resend и попробуйте ещё раз.",
    errorUnknown: "Что-то пошло не так. Попробуйте ещё раз.",
  },
};

export type AdminDict = typeof ru;

export const en: AdminDict = {
  language: {
    label: "Language",
    ru: "Русский",
    en: "English",
    switchAria: "Switch admin language",
  },
  nav: {
    homeAria: "Matio admin home",
    adminBadge: "Admin",
    shows: "Shows",
    actors: "Actors",
    analytics: "Analytics",
    trackedLinks: "Links",
    backToApp: "← Back to app",
  },
  actorsList: {
    eyebrow: "Catalog",
    title: "Virtual actors",
    total: (n: number) => `${n} total`,
    newActor: "New actor",
    noActorsYet: "No actors yet.",
    createFirstActor: "Add the first actor",
    showCount: (n: number) => `${n} ${n === 1 ? "show" : "shows"}`,
    edit: "Edit",
    delete: "Delete",
    deleteConfirm: (name: string) =>
      `Delete actor "${name}"? They will disappear from every show page. This cannot be undone.`,
  },
  actorForm: {
    identityKicker: "Identity",
    identityTitle: "Name, slug & bio",
    nameLabel: "Name",
    namePlaceholder: "NOVA",
    slugLabel: "Slug",
    slugHint: "lowercase-letters-and-hyphens",
    slugPlaceholder: "nova",
    taglineLabel: "Archetype",
    taglineHint: "One line under the name — e.g. the character archetype.",
    taglinePlaceholder: "AI detective with a dark past",
    bioLabel: "Bio",
    bioHint:
      "Shown in the hover card on show pages and on the actor's page.",
    bioPlaceholder: "A couple of sentences about the virtual actor.",
    avatarKicker: "Avatar",
    avatarTitle: "Actor portrait",
    avatarLabel: "Avatar",
    avatarHint:
      "Square 1:1 · 512×512 or larger. Used for the cast circle, hover card, and actor page.",
    createActor: "Create actor",
  },
  actorEdit: {
    backToActors: "Actors",
    viewOnSite: "View on site",
    appearsInKicker: "Appearances",
    appearsInTitle: "Shows featuring this actor",
    noAppearances:
      "Not part of any show yet. Cast is managed on each show's page.",
    asCharacter: (c: string) => `as ${c}`,
    deleteActorDescription:
      "Deleting removes the actor from every show page. This cannot be undone.",
    deleteConfirm: (name: string) =>
      `Delete actor "${name}"? This cannot be undone.`,
    deleteThisActor: "Delete actor",
  },
  showsList: {
    eyebrow: "Catalog",
    title: "Shows",
    totalAndPublished: (total: number, published: number) =>
      `${total} total · ${published} published`,
    newShow: "New show",
    noShowsYet: "No shows yet.",
    createFirstShow: "Create the first show",
    featured: "Featured",
    justReleased: "Just released",
    popular: "Popular",
    seasonCount: (n: number) => `${n} ${n === 1 ? "season" : "seasons"}`,
    updatedDate: (date: string) => `updated ${date}`,
    edit: "Edit",
    delete: "Delete",
    deleteConfirm: (title: string) =>
      `Delete "${title}"? This cannot be undone.`,
    statusDraft: "draft",
    statusPublished: "published",
  },
  errorBoundary: {
    title: "Something went wrong",
    unexpectedError: "An unexpected error occurred.",
    tryAgain: "Try again",
    backToAdminHome: "Back to admin home",
  },
  analytics: {
    eyebrow: "Analytics",
    heading: "Dashboard",
    rangeLast24Hours: "last 24 hours",
    rangeLast7Days: "last 7 days",
    rangeLast30Days: "last 30 days",
    rangeLast90Days: "last 90 days",
    rangeAllTime: "all time",
    rangeCustom: "custom range",
    rangeSelected: "selected range",
    touchFirst: "first-touch",
    touchLast: "last-touch",
    granularityToken: (g: string) => g,
    kpiSignups: "Signups",
    // "pre-purchase" — accounts created by a pay-first purchase
    // (signup_origin='guest_checkout') are excluded: they materialize at
    // payment and would double-read the "New subs" metric.
    kpiSignupsSub: (range: string) => `${range} · pre-purchase`,
    kpiTrialPreviews: "Trial previews",
    kpiConversions: "Conversions",
    kpiConversionsSub: "trials → paid",
    kpiTrialToPaid: "Sessions → paid",
    // "by session start" — the cohort is windowed on session start;
    // conversion lands later (Stripe webhook), so fresh windows read low.
    kpiSessionsSub: (converted: number | string, started: number | string) =>
      `${converted}/${started} sessions · by session start`,
    kpiMrr: "MRR",
    kpiCancellations: "Cancellations",
    // "by last update" — no canceled_at column; the window keys on
    // updated_at (last webhook mirror), so this is an approximation.
    kpiCancellationsSub: (range: string) => `${range} · by last update`,
    kpiActiveSub: (n: number) => `${n} active × $38`,
    kpiServicedSub: (n: number | string) => `${n} serviced`,
    kpiNewSubs: "New subs",
    // How many of the new subs came via the pay-first guest checkout
    // (signup_origin='guest_checkout'). These accounts are NOT in "Signups"
    // (created at purchase), so we surface them here to keep guest buyers
    // visible on the dashboard.
    kpiNewSubsGuestSub: (range: string, n: number) =>
      `${range} · ${n} via guest checkout`,
    sectionAcquisitionFunnel: "Acquisition funnel",
    sectionAcquisitionFunnelHint:
      "60s previews · started → engaged → near paywall → converted",
    funnelPreviewsStarted: "Trial previews started",
    funnelPreviewsStartedHint: "Distinct (session, show) trial rows in range",
    funnelPlayed: "Played (>0s)",
    funnelPlayedHint: "Trials that recorded any playhead",
    funnelReachedPaywall: "Reached paywall (~55s+)",
    funnelReachedPaywallHint: "Got near the 60s preview cap",
    funnelConverted: "Converted to paid",
    funnelConvertedHint: "Trial sessions now marked converted",
    funnelDepthNote: (n: number | string) =>
      `Trial depth is the last-saved resume playhead per session, not cumulative watch time — “played” undercounts very short previews that never ticked a save. Avg depth ${n}s of the 60s cap. Rows before 2026-05-31 were minted on page-load (not play) and undercount play-through.`,
    sectionSubscriptions: "Subscriptions",
    sectionSubscriptionsHintMix: (scope: string) => `mix · ${scope}`,
    scopeActiveOnly: "active only",
    scopeAllStatuses: "all statuses",
    scopeAccessGranting: "access-granting only",
    sectionTrend: "Trend",
    sectionChannelsCampaigns: (touch: string) =>
      `Channels & campaigns · ${touch}`,
    sectionChannelsCampaignsHintFirst:
      "which channel opened the relationship — switch to last-touch to reconcile with Meta/Google",
    sectionChannelsCampaignsHintLast:
      "what ad platforms attribute the conversion to",
    sectionTrialPreviewDepth: "Trial preview depth",
    sectionTrialPreviewDepthHint: "how far into the 60s preview viewers get",
    sectionSubscriberEngagement: "Subscriber engagement",
    sectionSubscriberEngagementHint:
      "watch_progress · subscriber-only · all-time",
    kpiCompletionRate: "Completion rate",
    kpiCompletionRateSub: (
      completed: number | string,
      total: number | string,
    ) => `${completed}/${total} finished`,
    kpiAvgPctWatched: "Avg % watched",
    kpiSampleSize: (n: number | string) => `n=${n}`,
    kpiAvgPerViewer: "Avg / viewer",
    minutes: (n: number | string) => `${n} min`,
    kpiViewersCount: (n: number) => `${n} viewer${n === 1 ? "" : "s"}`,
    kpiWatchRows: "Watch rows",
    kpiWatchRowsSub: "subscriber resume points",
    engagementApproxNote:
      "Approximate — resume playhead per (subscriber, episode), not cumulative minutes. Real watch-time is in the Mux panel below.",
    sectionTopShows: "Top shows",
    sectionTopShowsHint:
      "subscriber watch time (resume-position proxy) · all-time · approximate",
    topShowsRowSub: (viewers: number, pct: number | string) =>
      `${viewers} viewer${viewers === 1 ? "" : "s"} · ${pct}%`,
    topShowsEmpty: "No subscriber watch progress recorded yet.",
    sectionWatchTimeMux: "Watch time · Mux Data",
    sectionWatchTimeMuxHint: (window: string) =>
      `real playback · ${window} · hero excluded · consenting viewers only`,
    muxClampedNotice:
      "Mux Data caps at a 30-day window — showing the last 30 days even though the dashboard range is wider.",
    muxNotConnectedPrefix: "Not connected. Add a Mux access token with",
    muxNotConnectedAs: "as",
    muxNoData:
      "Connected — no views recorded in this window yet. Mux Data appears a few minutes after consenting viewers watch.",
    muxError:
      "Mux Data is unavailable right now — try refreshing in a minute.",
    kpiTotalWatchTime: "Total watch time",
    hours: (n: number | string) => `${n} h`,
    kpiViews: "Views",
    kpiUniqueViewers: "Unique viewers",
    kpiAvgView: "Avg view",
    kpiAvgViewSub: "per view",
    muxByShowViews: (n: number) =>
      `${n.toLocaleString()} view${n === 1 ? "" : "s"}`,
    campaignTableEmpty:
      "No campaign data in this range. Tag landing URLs with utm_source / utm_medium / utm_campaign to attribute.",
    campaignSessionsNote:
      "Sessions counts both 60s previews and free-tier sessions — totals exceed the preview-only funnel above.",
    tableColCampaign: "Campaign",
    tableColSourceMedium: "Source / medium",
    tableColTrials: "Sessions",
    tableColSignups: "Signups",
    tableColSubs: "New subs",
    tableColTrialToSub: "Sess→sub",
    tableColTrialToSubTitle:
      "In-range subs over in-range sessions — linked by attribution only, not a per-session cohort",
    tableColMrr: "New MRR",
    tableColWall: "Wall %",
    tableColWallTitle:
      "Share of sessions reaching the preview paywall (≥55s), the sign-up wall, or the end of the free tier",
    // ---- episode-gated funnel (free tier, per show) ----
    episodeFunnelTitle: (title: string) => `Episode funnel · ${title}`,
    episodeFunnelHint: (free: number, member: number, range: string) =>
      `${free} free + ${member} member episodes · ${range}`,
    efStarted: "Started watching free",
    efStartedHint: "Anonymous sessions that played a free episode in range",
    efWallHit: "Hit sign-up wall",
    efWallHitHint: "Wall shown, or reached the end of the free tier",
    // Variant for shows with no member episodes: after the free tier the
    // viewer lands straight on the subscription paywall (pay-first) — there
    // is no sign-up wall.
    efPaywallDirect: "Hit subscription paywall",
    efPaywallDirectHint:
      "Reached the end of the free tier — next stop is the paywall (no member episodes on this show)",
    efSignedUp: "Got an account",
    efSignedUpHint:
      "Wall-stage sessions linked to a user account. Under pay-first the account is created at purchase — no longer a pre-payment signup",
    efMemberWatchers: "Watched member episodes",
    efMemberWatchersHint: "Linked users with progress on any member episode",
    efPaywallHit: "Hit subscription paywall",
    efPaywallHitHint: "Linked users who completed the last member episode",
    efSubscribed: "Subscribed",
    efSubscribedHint:
      "Funnel sessions marked converted by the Stripe webhook",
    efMemberEpisodesLabel: "Member episodes · linked users",
    efCompleted: (n: number | string) => `${n} completed`,
    efViewers: (n: number) =>
      `${n.toLocaleString()} viewer${n === 1 ? "" : "s"}`,
    efNoMemberViews: "No member-episode views yet.",
    efDepthLabel: "Free-tier depth · sessions reaching episode N",
    efDepthNote:
      "Depth is the furthest episode position a session started (write-monotonic), not completion. Account linking: classic signups use the trial cookie with an IP-bucket fallback (can slightly over-attribute on shared networks); pay-first purchases link by exact token only (can under-attribute when a webview dropped the cookie).",
    // ---- Free mode: organic funnel (PAYMENTS_ENABLED unset) ----
    freeModeBadge: "free mode",
    kpiFreeSessions: "Watch sessions",
    // “browsers” = distinct trial cookies in range (one cookie can open
    // several shows → sessions exceed browsers).
    kpiFreeSessionsSub: (viewers: number) =>
      `${viewers.toLocaleString()} browser${viewers === 1 ? "" : "s"}`,
    kpiPlayed: "Started watching",
    kpiPctOfSessions: (pct: number | string) => `${pct}% of sessions`,
    kpiEngaged2: "2+ episodes",
    kpiAvgDepth: "Episodes per session",
    kpiAvgDepthSub: "among sessions that played",
    sectionOrganicFunnel: "Organic funnel",
    sectionOrganicFunnelHint:
      "anonymous watch sessions in range · no walls, no payments",
    ofSessions: "Sessions",
    ofSessionsHint:
      "trial_sessions row (browser × show), minted when the player starts",
    ofPlayed: "Started watching",
    ofPlayedHint: "Has a saved position — frames actually rendered",
    ofEngaged2: "Reached episode 2",
    ofEngaged2Hint: "Furthest episode started ≥ 2",
    ofEngaged3: "Reached episode 3",
    ofEngaged3Hint: "Furthest episode started ≥ 3",
    organicDepthNote: (avg: number | string) =>
      `Avg ${avg} episodes per session among those that played. Session counts are a floor: the 10-mints-per-(IP, show)-hour cap silently drops tracking on hot networks (CGNAT, webviews), and EU visitors carry no UTM cookies before consent.`,
    sectionSources: "Traffic sources",
    sourcesBySourceLabel: "Sessions by source",
    sourcesEmpty:
      "No tagged traffic yet — create a tracked link and share it.",
    sourceSessionsCount: (n: number) =>
      `${n.toLocaleString()} session${n === 1 ? "" : "s"}`,
    sourceRowSub: (viewers: number) =>
      `${viewers.toLocaleString()} browser${viewers === 1 ? "" : "s"}`,
    tableColSessions: "Sessions",
    tableColPlayedPct: "Played",
    tableColAvgEps: "Eps/session",
    tableColDeepPct: "2+ eps",
    campaignFreeNote:
      "Sessions are anonymous watch sessions under the selected attribution model; “(direct)” means no UTM tags (organic, hand-typed URLs and pre-consent EU clicks). Signups are accounts whose touch under the selected model matched the campaign.",
    sectionTrackedLinks: "Tracked links",
    sectionTrackedLinksHint: "first-touch · selected range",
    trackedLinksManage: "Manage links →",
    trackedLinksEmpty:
      "No links yet. Create one under “Links” and share it on social.",
    tlColName: "Link",
    tlColTarget: "Target",
    tlColSessions: "Sessions",
    tlColPlayed: "Played",
    tlColSignups: "Signups",
    tlColAllTime: "All time",
    showDepthTitle: (title: string) => `Depth · ${title}`,
    showDepthHint: (started: number, range: string) =>
      `${started.toLocaleString()} session${started === 1 ? "" : "s"} · ${range}`,
    showDepthPlayed: (n: number | string) => `started watching: ${n}`,
    showDepthBarsNote:
      "Sessions that reached episode N (cumulative, by furthest episode started).",
    sectionSignedInEngagement: "Engagement · signed-in viewers",
    sectionSignedInEngagementHint:
      "watch_progress: viewers with an account (any signed-in user while free mode is on) · all time",
    // ---- Signup funnel (REQUIRE_SIGNUP: anonymous playback gated, the top
    // of funnel lives only in PostHog) ----
    sectionSignupFunnel: "Signup funnel",
    signupFunnelHint: "site-wide · range only — filters don't apply",
    sfVisitors: "Visitors",
    sfVisitorsHint: "Unique visitors per PostHog ($pageview)",
    sfWall: "Saw the signup wall",
    sfWallHint: "signup_wall_shown event (PostHog), unique visitors",
    sfSignups: "Signed up",
    sfSignupsHint: "Accounts created in range (clerk_signup) — from our DB",
    sfWatching: "New signups who watched",
    sfWatchingHint:
      "Of the in-range signups — saved watch progress (watch_progress, DB)",
    sfBySourceLabel: "Visitors by source (PostHog)",
    sfBySourceEmpty: "No pageviews in range.",
    sfSourceRowSub: (wall: number) => `saw the wall: ${wall.toLocaleString()}`,
    sfVisitorsCount: (n: number) =>
      `${n.toLocaleString()} visitor${n === 1 ? "" : "s"}`,
    sfConsentNote:
      "Visitors and Wall are PostHog persons: only browsers that consented to marketing cookies are counted (outside the EU consent defaults on), so they are a floor. Signed up and Watched come from our own DB.",
    sfNotConnected1:
      "Panel not connected. Create a PostHog personal API key with the",
    sfNotConnected2: "scope and set",
    sfError: "Couldn't fetch PostHog data.",
    ofGateNote:
      "Mandatory signup (REQUIRE_SIGNUP) has been on since 2026-07-16: anonymous sessions are no longer minted and this funnel stops filling. The live top of funnel is in “Signup funnel” above.",
  },
  showNew: {
    backToShows: "Shows",
    eyebrow: "New show",
    heading: "Create a show",
    subheading: "You can add seasons and episodes after it’s created.",
  },
  showEdit: {
    backToShows: "Shows",
    viewOnSite: "View on site",
    homeHeroKicker: "Home hero",
    featuredShowTitle: "Featured show",
    heroCurrentDescription:
      "This show is the home-page hero. Only one show can hold the hero at a time.",
    removeFromHero: "Remove from hero",
    heroPromoteDescription:
      "Promote this show to the home-page hero. The current hero will be unfeatured.",
    heroPublishFirstDescription:
      "Publish the show first — only published shows can be featured.",
    featureOnHome: "Feature on home",
    contentKicker: "Content",
    seasonsTitle: "Seasons",
    seasonCount: (n: number) => `${n} ${n === 1 ? "season" : "seasons"}`,
    noSeasonsEmptyState: "No seasons yet. Add the first one below.",
    seasonLabel: (n: number) => `Season ${n}`,
    episodes: "Episodes",
    deleteSeasonConfirm: (n: number) =>
      `Delete Season ${n}? All its episodes will also be removed.`,
    delete: "Delete",
    seasonNumberPlaceholder: "#",
    seasonNumberAria: "Season number",
    seasonTitlePlaceholder: "Title (optional)",
    seasonTitleAria: "Season title",
    add: "Add",
    dangerZone: "Danger zone",
    deleteShowDescription:
      "Deleting removes this show from the catalog. Seasons and episodes go with it.",
    deleteShowConfirm: (title: string) =>
      `Delete "${title}"? This cannot be undone.`,
    deleteThisShow: "Delete this show",
    statusDraft: "draft",
    statusPublished: "published",
    featured: "Featured",
    castKicker: "Cast",
    castTitle: "Virtual actors",
    castCount: (n: number) => `${n} ${n === 1 ? "actor" : "actors"}`,
    noCastYet: "No actors added yet. Add the first one below.",
    characterPlaceholder: "Character (optional)",
    characterAria: (name: string) => `${name}'s character in this show`,
    characterAddAria: "Character in this show",
    saveCharacter: "Save",
    moveUpAria: (name: string) => `Move ${name} up`,
    moveDownAria: (name: string) => `Move ${name} down`,
    removeCastConfirm: (name: string) =>
      `Remove "${name}" from this show's cast? The actor itself is not deleted.`,
    removeFromCast: "Remove",
    addToCast: "Add",
    selectActorAria: "Pick an actor",
    selectActorPlaceholder: "— actor —",
    allActorsAdded: "Every existing actor is already in the cast.",
    noActorsExistHint: "No actors exist yet — create them first.",
    manageActorsLink: "Manage actors →",
  },
  season: {
    seasonN: (n: number) => `Season ${n}`,
    episodeCountReady: (count: number, ready: number) =>
      `${count} ${count === 1 ? "episode" : "episodes"} · ${ready} ready`,
    panelKickerContent: "Content",
    panelTitleEpisodes: "Episodes",
    emptyEpisodes: "No episodes yet. Add the first one below.",
    edit: "Edit",
    deleteEpisodeConfirm: (number: number, title: string) =>
      `Delete episode ${number} "${title}"? This cannot be undone.`,
    delete: "Delete",
    addAnEpisode: "Add an episode",
    fieldNumber: "Number",
    fieldTitle: "Title",
    episodeTitlePlaceholder: "Episode title",
    fieldDescription: "Description",
    descriptionPlaceholder: "Optional synopsis.",
    addEpisodeButton: "Add episode",
  },
  episode: {
    backLabelSeason: (showTitle: string, n: number) =>
      `${showTitle} · Season ${n}`,
    kickerSeasonEpisode: (s: number, e: number) =>
      `Season ${s} · Episode ${e}`,
    videoKicker: "Video",
    replaceVideo: "Replace video",
    uploadVideo: "Upload video",
    videoUploadHint:
      "Files upload directly to Mux. After upload, Mux transcodes and the status flips to Ready automatically.",
    noPreviewYet: "No preview yet",
    noVideo: "No video",
    metaStatus: "Status",
    metaDuration: "Duration",
    metaAssetId: "Asset ID",
    metaPlaybackId: "Playback ID",
    detailsKicker: "Details",
    episodeInfo: "Episode info",
    fieldNumber: "Number",
    fieldTitle: "Title",
    fieldDescription: "Description",
    skipIntro: "Skip intro",
    skipIntroBlankHint: "Leave both blank to hide the chip",
    fieldStart: "Start",
    fieldEnd: "End",
    secondsHint: "seconds",
    skipIntroPlaceholderStart: "e.g. 5",
    skipIntroPlaceholderEnd: "e.g. 60",
    introRangeError: "Intro end must be after intro start.",
    skipIntroExplain:
      "The player shows a “Skip intro” pill while playback is in this window and seeks to End on click.",
    savingPending: "Saving…",
    saveChanges: "Save changes",
    deleteDescription:
      "Deleting removes this episode and its video link. This cannot be undone.",
    deleteConfirm: (n: number, title: string) =>
      `Delete episode ${n} "${title}"? This cannot be undone.`,
    deleteThisEpisode: "Delete this episode",
  },
  analyticsSpec: {
    eyebrow: "Analytics",
    heading: "Do viewers come back",
    ledgerNote:
      "Visits, geo and sources come from our own first-party counter (no third-party services); data accrues from the panel's deploy — older periods are empty.",
    na: "—",
    freshNote: "No data for this period yet — the ledger fills from deploy.",
    filterCustom: "Custom",
    filterFrom: "from",
    filterTo: "to",
    filterSource: "Source",
    filterAllSources: "All sources",
    filterCountry: "Country",
    filterAllCountries: "All countries",
    filterWindow: "liveness window",
    kpiVisits: "Visits",
    kpiRegistrations: "Registrations",
    kpiConversion: (pct: string) => `${pct} of visits`,
    kpiNorthStar: "Deep watch ≥80%",
    kpiNorthStarSub: (deep: number, total: number) =>
      `${deep} of ${total} new users`,
    kpiReleaseRetention: "Release retention",
    kpiReleaseRetentionSub: (ret: number, fin: number) =>
      `${ret} of ${fin} finishers`,
    sectionPulse: "Project pulse",
    pulseHint: (w: number) =>
      `living audience = unique viewers over a rolling ${w} days`,
    pulseNetWeek: (added: number, lost: number) =>
      `this week (+${added} new · −${lost} lost)`,
    pulseWau: (w: number) => `Living audience (${w}d)`,
    pulseNew: "New",
    pulseReturning: "Returning",
    pulseLost: "Lost",
    pulseRelease: "Release",
    sectionFunnel: "Full funnel",
    funnelHint: "cohort: visitors first seen in the period",
    fVisited: "Visited the site",
    fVisitedHint: (home: number) => `of which the homepage: ${home}`,
    fShow: "Opened a show",
    fWall: "Hit the sign-up gate",
    fRegistered: "Registered",
    fStarted: "Started an episode",
    f25: "Reached 25%",
    f50: "Reached 50%",
    f80: "Reached 80%",
    f100: "Finished",
    sectionGeo: "Geography",
    geoHint: "not “where traffic comes from” but which countries actually watch",
    geoEmpty: "No registrations in this period yet",
    geoUnknown: "Unknown",
    geoMapValue: (n: number) => `registrations: ${n}`,
    thCountry: "Country",
    thVisits: "Visits",
    thConversion: "Reg. conv.",
    thCompletion: "Completion",
    thReleaseRet: "Release ret.",
    sectionMatrix: "Sources × geo",
    matrixHint: "quality, not volume",
    thSource: "Source",
    sourceOther: "Other",
    matrixCellTitle: (visits: number, regs: number) =>
      `visits: ${visits}, registrations: ${regs}`,
    matrixCellHint:
      "per cell: registration conversion · deep watch (≥80% of the first episode); highlight follows deep watch",
    sectionContent: "Content: episodes and retention",
    contentHint: "starts and completions are for registered viewers",
    widgetAvgPerDay: "Avg watch per viewer-day",
    widgetTotal: "Total hours watched",
    widgetViewerDays: "Viewer-days",
    hoursSuffix: "h",
    thEpisode: "Episode",
    thStarts: "Starts",
    thCompletionRate: "Completion",
    thAvgWatched: "Avg % watched",
    thRewatches: "Rewatches",
    curveTitle: (label: string) => `Retention curve — ${label}`,
    curveYAxis: "% of starts",
    curveViews: "views",
    curveNoData:
      "The curve appears after the first views — per-second tracking is live since the panel's deploy.",
    durationPlotTitle: "Completion × episode length",
    sectionRelease: "Release retention by show",
    releaseHint: "finished ep N → started ep N+1 within 7 days of its release",
    releaseEmpty:
      "Fills in once a show has ≥2 released episodes and first completions.",
  },
  analyticsSessions: {
    eyebrow: "Analytics",
    heading: "Sessions",
    subtitle: "An event feed for every visit",
    tabOverview: "Overview",
    tabSessions: "Sessions",
    coverageNote:
      "Source — PostHog: only cookie-consented visits appear (EU pre-banner and some ad-blocked traffic are invisible here). Times are UTC.",
    listTitle: "Sessions",
    sessionsCount: (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`,
    notConfiguredTitle: "PostHog is not connected",
    notConfiguredBody:
      "This page reads sessions via the HogQL API. Set POSTHOG_PERSONAL_API_KEY (a personal API key with the query:read scope) and POSTHOG_PROJECT_ID in the environment and redeploy.",
    loadError: "Could not load sessions from PostHog",
    empty: "No sessions in this period",
    anonymous: "Anonymous",
    direct: "Direct",
    eventsCount: (n: number) => `${n} ${n === 1 ? "event" : "events"}`,
    durationSec: (n: number) => `${n} sec`,
    durationMin: (n: number) => `${n} min`,
    timeAgoNow: "just now",
    timeAgoMin: (n: number) => `${n} min ago`,
    timeAgoHr: (n: number) => `${n} h ago`,
    timeAgoDay: (n: number) => `${n} d ago`,
    endedOn: (path: string) => `Ended on ${path}`,
    replay: "Session replay ↗",
    showMore: "Show more",
    moreEvents: (n: number) =>
      `${n} more ${n === 1 ? "event" : "events"} hidden`,
    epShort: (n: number) => `ep. ${n}`,
    // Timeline event types (key = PostHog event name).
    eventLabels: {
      $pageview: "opened a page",
      $pageleave: "left the page",
      show_viewed: "show page",
      trial_play_started: "preview started",
      free_episode_started: "started an episode",
      member_episode_started: "started an episode",
      play_attempted: "pressed play",
      first_frame: "video started",
      playback_failed: "playback failed",
      episode_auto_advanced: "auto-advanced to the next episode",
      signup_wall_shown: "saw the signup wall",
      paywall_shown: "saw the paywall",
      signup_cta_clicked: "clicked the signup CTA",
      signup_completed: "signed up",
      checkout_started: "started checkout",
      subscribe_succeeded: "subscribed",
      welcome_signin_succeeded: "signed in after purchase",
      welcome_signin_failed: "failed to sign in after purchase",
      welcome_fallback_shown: "fallback sign-in shown",
    },
  },
  analyticsFilters: {
    presetAll: "All",
    customPreset: "Custom",
    granularityAuto: "Auto",
    granularityHourly: "Hourly",
    granularityDaily: "Daily",
    granularityWeekly: "Weekly",
    granularityMonthly: "Monthly",
    fromDateAria: "From date",
    toDateAria: "To date",
    intervalLabel: "Interval",
    showLabel: "Show",
    allShows: "All shows",
    channelLabel: "Channel",
    allChannels: "All channels",
    campaignLabel: "Campaign",
    allCampaigns: "All campaigns",
    subsLabel: "Subs",
    statusAccessGranting: "Access-granting",
    statusActiveOnly: "Active only",
    statusAll: "All statuses",
    firstTouch: "First-touch",
    lastTouch: "Last-touch",
    reset: "Reset",
  },
  charts: {
    approxBadge: "APPROX",
    approxTooltip:
      "Approximate — derived from last-saved playhead, not cumulative watch time",
    noChange: "no change",
    newDelta: "new",
    vsPreviousPeriod: (prev: number | string) =>
      `vs previous period (${prev})`,
    noDataYet: "No data yet.",
    ofPrev: (pct: string) => `${pct} of prev`,
    noSubscriptionsYet: "No subscriptions yet.",
    subs: "subs",
  },
  formSubmit: {
    savingDefault: "Saving…",
  },
  imageUpload: {
    notAnImage: "That doesn’t look like an image file.",
    uploadFailed: "Upload failed",
    altPreview: (label: string) => `${label} preview`,
    dropOrClickToReplace: "Drop or click to replace",
    couldntLoadUrl: "Couldn’t load this URL",
    dropImage: "Drop image",
    orBrowse: "or browse",
    formatHint: "PNG, JPG, WebP · uploaded to Blob",
    uploadingPercent: (percent: string) => `Uploading · ${percent}%`,
    urlPlaceholder: "/shows/my-show-poster.png — or drop a file above",
    dismiss: "Dismiss",
  },
  showForm: {
    identityKicker: "Identity",
    identityTitle: "Title, slug & story",
    titleLabel: "Title",
    titlePlaceholder: "QUÉDATE CONMIGO",
    slugLabel: "Slug",
    slugHint: "lowercase-with-hyphens",
    slugPlaceholder: "quedate-conmigo",
    descriptionLabel: "Description",
    descriptionPlaceholder: "One or two sentences that sell the show.",
    genreLabel: "Genre",
    genreHint: "Comma-separated. Shown as tags on the catalog.",
    genrePlaceholder: "romance, thriller, drama",
    artworkKicker: "Artwork",
    artworkTitle: "Poster & hero",
    artworkHint:
      "Drop a file to upload — the preview shows the exact crop the site will render.",
    posterLabel: "Poster",
    posterHint: "Portrait 2:3 · 1024×1536. Catalog cards + OG fallback.",
    heroLabel: "Hero",
    heroHint:
      "Wide ≈21:9 · 2560×1080, no baked title. Detail page + home hero. Keep subjects in the centre 60%.",
    visibilityKicker: "Visibility",
    visibilityTitle: "Status & placement",
    statusLabel: "Status",
    statusHint: "Drafts are hidden from the public catalog.",
    orientationLabel: "Video format",
    orientationHint:
      "Vertical switches to a TikTok-style player on phones. Desktop looks the same either way.",
    homepageRowsLabel: "Homepage rows",
    homepageRowsHint:
      "Which rows this show appears in on the home page. It can be in both, either, or neither (still reachable via its URL).",
    justReleasedLabel: "Just released",
    popularNowLabel: "Popular now",
    unsavedChanges: "Unsaved changes",
    allChangesSaved: "All changes saved",
    cancel: "Cancel",
    saving: "Saving…",
    createShow: "Create show",
    saveChanges: "Save changes",
  },
  // Copy for the typed AdminFormState error codes (createShow / updateShow /
  // createActor / updateActor in app/admin/actions.ts) — same pattern as
  // links.err*: an inline form error instead of the generic error page.
  formErrors: {
    titleRequired: "Title is required.",
    nameRequired: "Name is required.",
    slugRequired: "Slug is required.",
    slugInvalid: "Slug must be lowercase letters, numbers, and hyphens.",
    slugTaken: "That slug is already taken — pick another.",
    unknown: "Couldn’t save. Try again.",
    notSaved: "Not saved",
  },
  statusSelect: {
    draft: "Draft",
    published: "Published",
  },
  orientationSelect: {
    horizontal: "Horizontal (16:9)",
    vertical: "Vertical (9:16)",
  },
  accessSelect: {
    free: "Free",
    member: "Members",
    subscriber: "Subscribers",
    whoCanWatch: "Who can watch",
    whoCanWatchHint:
      "Free — anyone, no account. Members — any signed-in user. Subscribers — paid members only.",
  },
  timeSeriesChart: {
    metricTrials: "Trials",
    metricFree: "Free tier",
    // Same kind='episodes' metric relabeled for free mode — there it is
    // simply “sessions”; “free tier” and “previews” carry no meaning.
    metricSessions: "Sessions",
    metricSignups: "Signups",
    metricConversions: "Conversions",
    metricNewSubs: "New subs",
    total: (n: number | string) => `${n} total`,
    noData: "No data in this range.",
    peak: (n: number | string) => `peak ${n}`,
  },
  uploadWidget: {
    invalidVideoFile: "That doesn’t look like a video file.",
    failedToStartUpload: "Failed to start upload",
    uploadFailed: "Upload failed",
    uploadFinishedButMarkFailed:
      "Upload finished but the server couldn’t mark the episode reprocessing",
    dropVideoPrefix: "Drop a video here, or ",
    browse: "browse",
    acceptedFormatsHint:
      "MP4, MOV, or any video file · uploaded straight to Mux",
    uploadedBadge: "Uploaded",
    remove: "Remove",
    preparingUpload: "Preparing upload…",
    uploadingProgress: (percent: string) => `Uploading · ${percent}%`,
    transcodingNotice: "Transcoding on Mux — this page will refresh",
    startUpload: "Start upload",
    dismiss: "Dismiss",
  },
  adminUi: {
    dangerZone: "Danger zone",
    noVideo: "No video",
    ready: "Ready",
    error: "Error",
    processing: "Processing",
  },
  links: {
    eyebrow: "Marketing",
    heading: "Tracked links",
    sub: "UTM-tagged links for social posts: the dashboard shows where viewers came from and how deep they watch.",
    formKicker: "New link",
    formTitle: "Generate a link",
    nameLabel: "Name",
    namePlaceholder: "July IG reel",
    nameHint: "Admin-only label — it never appears in the link itself.",
    targetLabel: "Target",
    targetHome: "Home page",
    targetWatch: (title: string) => `Player — ${title}`,
    targetShow: (title: string) => `Show page — ${title}`,
    targetCustom: "Custom path…",
    customPathLabel: "Path",
    customPathPlaceholder: "/watch/my-show",
    customPathHint:
      "Starts with “/”, no ?, # or domain — the tags are appended automatically.",
    sourceLabel: "Source · utm_source",
    sourceCustom: "Other…",
    sourceCustomPlaceholder: "pinterest",
    mediumLabel: "Medium · utm_medium",
    mediumHint: "“social” for organic posts, “paid” for ads.",
    campaignLabel: "Campaign · utm_campaign",
    campaignPlaceholder: "ig-reel-0715",
    campaignHint:
      "A unique name per post or placement — that’s what makes each one measurable.",
    aliasNote:
      "Values are canonicalized automatically: lowercase, [a-z0-9_-] only; instagram → ig, facebook and meta → fb.",
    previewLabel: "Your link will be",
    // Interpolated into copyAria as the link name for the preview's copy button.
    previewCopyName: "preview",
    submit: "Create link",
    submitPending: "Creating…",
    createdOk: "Link created — copy it from the table below.",
    errNameRequired: "Name is required.",
    errTargetInvalid:
      "The path must start with “/” and contain no ?, # or domain.",
    errUtmRequired:
      "Source, medium and campaign are required — and must survive normalization.",
    errDuplicate:
      "An active link with this source · medium · campaign combination already exists — pick a different campaign name.",
    errShowNotFound: "Show not found.",
    errUnknown: "Couldn’t create the link. Try again.",
    tableKicker: "Links",
    tableTitle: "All links",
    tableHint:
      "Sessions are first-touch: browsers whose first tagged visit carried this link’s tags.",
    colName: "Name",
    colTarget: "Target",
    colSessions30: "Sessions · 30d",
    colPlayed: "Played",
    colSignups: "Signups",
    colAllTime: "All time",
    colCreated: "Created",
    copy: "Copy",
    copied: "Copied",
    copyAria: (name: string) => `Copy link “${name}”`,
    archive: "Archive",
    archiveConfirm: (name: string) =>
      `Archive “${name}”? Sessions matched to its tags stay in analytics; the tag combination becomes reusable.`,
    empty: "No links yet — create the first one above.",
    consentNote:
      "In the EU, tags persist only after cookie consent, so some clicks land in “(direct)”. Outside the EU tags are written on first visit.",
  },
  reminders: {
    kicker: "Email",
    title: "Episode reminders",
    pendingBadge: (n: number) =>
      `${n} ${n === 1 ? "address waiting" : "addresses waiting"}`,
    description:
      "Viewers who left their email after the finale. Pick the episode that just dropped — each gets an email linking straight to it.",
    episodeAria: "Episode to announce",
    episodeOption: (s: number, e: number, title: string | null) =>
      `S${s} · E${e}${title ? ` — ${title}` : ""}`,
    confirmSend: (n: number) =>
      `Send the reminder email to ${n} ${n === 1 ? "address" : "addresses"}?`,
    sendCta: "Send",
    sendPending: "Sending…",
    sentOk: (n: number) => `Sent ${n} ${n === 1 ? "email" : "emails"}.`,
    noPending:
      "Nobody is waiting for an email yet. The capture form shows after a show's final episode.",
    sentSoFar: (n: number) => `Sent so far: ${n}`,
    notConfigured:
      "Resend isn't connected — set RESEND_API_KEY to send email. Addresses keep being collected meanwhile.",
    publishFirst:
      "Publish the show first — the email links to the public watch page.",
    noEpisodes: "No ready episodes to announce.",
    errorEpisodeInvalid: "Episode not found or not ready.",
    errorNoPending: "No addresses waiting for an email.",
    errorSendFailed:
      "Resend returned an error — some emails may not have gone out. Check the Resend dashboard and try again.",
    errorUnknown: "Something went wrong. Try again.",
  },
};

export const ADMIN_DICTS = { ru, en } as const;

export function adminDictFor(locale: AdminLocale): AdminDict {
  return locale === "en" ? en : ru;
}
