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
    analytics: "Аналитика",
    backToApp: "← Вернуться на сайт",
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
      "Доля сессий, дошедших до пейволла превью (≥55 с) или до стены регистрации",
    // ---- воронка эпизодов (бесплатный уровень, по сериалу) ----
    episodeFunnelTitle: (title: string) => `Воронка эпизодов · ${title}`,
    episodeFunnelHint: (free: number, member: number, range: string) =>
      `бесплатных: ${free} · по аккаунту: ${member} · ${range}`,
    efStarted: "Начали смотреть бесплатно",
    efStartedHint: "Анонимные сессии, запустившие бесплатный эпизод за период",
    efWallHit: "Дошли до стены регистрации",
    efWallHitHint: "Стена показана, или бесплатные эпизоды закончились",
    efSignedUp: "Зарегистрировались",
    efSignedUpHint: "Сессии со стены, привязанные к аккаунту",
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
      "Глубина — позиция самого дальнего начатого эпизода за сессию (монотонная запись), не досмотр. Привязка регистрации идёт по trial-cookie с IP-фолбэком, поэтому «зарегистрировались» может слегка завышаться в общих сетях.",
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
  statusSelect: {
    draft: "Черновик",
    published: "Опубликован",
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
    analytics: "Analytics",
    backToApp: "← Back to app",
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
      "Share of sessions reaching the preview paywall (≥55s) or the sign-up wall",
    // ---- episode-gated funnel (free tier, per show) ----
    episodeFunnelTitle: (title: string) => `Episode funnel · ${title}`,
    episodeFunnelHint: (free: number, member: number, range: string) =>
      `${free} free + ${member} member episodes · ${range}`,
    efStarted: "Started watching free",
    efStartedHint: "Anonymous sessions that played a free episode in range",
    efWallHit: "Hit sign-up wall",
    efWallHitHint: "Wall shown, or reached the end of the free tier",
    efSignedUp: "Signed up",
    efSignedUpHint: "Wall-stage sessions linked to a user account",
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
      "Depth is the furthest episode position a session started (write-monotonic), not completion. Sign-up linking uses the trial cookie with an IP-bucket fallback, so “signed up” can slightly over-attribute on shared networks.",
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
  statusSelect: {
    draft: "Draft",
    published: "Published",
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
};

export const ADMIN_DICTS = { ru, en } as const;

export function adminDictFor(locale: AdminLocale): AdminDict {
  return locale === "en" ? en : ru;
}
