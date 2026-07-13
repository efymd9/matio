import "server-only";

// "New episode" reminder email — subject + HTML + text renderer, used by
// the admin send action (app/admin/reminder-actions.ts).
//
// Layout implements the 2026-07-13 design handoff
// (design_handoff_new_episode_email): dark 600px column, hero episode
// still, burgundy "NEW EPISODE" pill, Arial Black display title, meta
// row, bulletproof gold CTA, wordmark header/footer. The handoff HTML is
// already email-safe (tables, inline styles, MSO conditional, bgcolor
// duplication, hidden preheader) — preserve those techniques when
// editing. Deliberate deviations from the mock: wordmark rendered at its
// true aspect ratio (102×49, not the mock's 102×40), no rating in the
// meta row (no such column — never invent one), no "Notification
// settings" link (no such page), and the real sole-trader postal line
// instead of the mock's placeholder address.
//
// Copy lives HERE, not in lib/i18n/dictionaries.ts: the public dict is a
// universal module bundled into every client, and email strings would be
// dead weight there. Emails render server-side at send time in the locale
// captured on the reminder row (show_reminders.locale).

type ReminderEmailInput = {
  locale: string; // "es" | "en" (free text from the DB; anything non-"es" renders English)
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string | null;
  // Meta row + logline — all optional, rows collapse when absent.
  genre: string[] | null; // shows.genre array; first entry is shown
  durationSeconds: number | null;
  logline: string | null; // episodes.description
  // Signed Mux thumbnail (long TTL) or null → hero row is omitted.
  heroImageUrl: string | null;
  watchUrl: string;
  unsubscribePageUrl: string;
  siteUrl: string; // origin for the wordmark image + header link
};

const COPY = {
  es: {
    subject: (show: string) => `Nuevo episodio de ${show} — ya disponible`,
    preheader: (show: string) =>
      `El siguiente episodio de ${show} ya está listo para ver.`,
    badge: "Nuevo episodio",
    kicker: (show: string, season: number, ep: number) =>
      season > 1 ? `${show} · T${season} · E${ep}` : `${show} · Episodio ${ep}`,
    minutes: (m: number) => `${m} min`,
    cta: "Ver ahora — gratis",
    heroAlt: (title: string, show: string) =>
      `${title} — fotograma de ${show}`,
    footerReason: (show: string) =>
      `Recibes este correo porque pediste que te avisáramos del próximo episodio de ${show} en matio.tv.`,
    unsubscribe: "Darse de baja",
  },
  en: {
    subject: (show: string) => `New episode of ${show} — out now`,
    preheader: (show: string) =>
      `The next episode of ${show} is ready to watch.`,
    badge: "New episode",
    kicker: (show: string, season: number, ep: number) =>
      season > 1 ? `${show} · S${season} · E${ep}` : `${show} · Episode ${ep}`,
    minutes: (m: number) => `${m} min`,
    cta: "Watch now — free",
    heroAlt: (title: string, show: string) =>
      `${title} — still from ${show}`,
    footerReason: (show: string) =>
      `You're getting this because you asked to be notified when a new episode of ${show} drops on matio.tv.`,
    unsubscribe: "Unsubscribe",
  },
} as const;

// Postal identification in the footer — sender-identification requirement
// (UK PECR / CAN-SPAM); matches the legal pages' sole-trader details.
const SENDER_LINE =
  "Matvei Dobrovolskii t/a Matio · 221 Derby Road, Nottingham, United Kingdom";
const TAGLINE = "Story worlds. One studio.";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstGenre(genre: string[] | null): string | null {
  const g = genre?.[0]?.trim();
  if (!g) return null;
  return g.charAt(0).toUpperCase() + g.slice(1);
}

export function renderShowReminderEmail(input: ReminderEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = input.locale === "es" ? COPY.es : COPY.en;
  const title = input.episodeTitle?.trim() || input.showTitle;
  const kicker = c.kicker(
    input.showTitle,
    input.seasonNumber,
    input.episodeNumber,
  );

  const subject = c.subject(input.showTitle);
  const preheader = input.logline?.trim() || c.preheader(input.showTitle);
  const wordmarkUrl = `${input.siteUrl}/brand/matio-wordmark.png`;

  // Meta row: genre · duration — rust bullets between whatever exists.
  const metaParts: string[] = [];
  const genre = firstGenre(input.genre);
  if (genre) metaParts.push(escapeHtml(genre));
  if (input.durationSeconds && input.durationSeconds > 0) {
    metaParts.push(
      escapeHtml(c.minutes(Math.max(1, Math.round(input.durationSeconds / 60)))),
    );
  }
  const metaHtml = metaParts.join(
    '&nbsp;<span style="color:#a8401f;">&bull;</span>&nbsp; ',
  );

  const heroRow = input.heroImageUrl
    ? `
  <!-- Hero still -->
  <tr><td style="padding:0;">
    <a href="${input.watchUrl}" style="text-decoration:none;display:block;">
      <img src="${input.heroImageUrl}" width="600" height="340" alt="${escapeHtml(c.heroAlt(title, input.showTitle))}" style="display:block;width:100%;height:auto;border:0;background-color:#5c2416;color:#f6efe4;font-family:Arial,Helvetica,sans-serif;font-size:14px;">
    </a>
  </td></tr>`
    : "";

  const metaRow = metaHtml
    ? `
      <tr><td style="padding:0 0 18px 0;">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:rgba(246,239,228,0.55);">${metaHtml}</span>
      </td></tr>`
    : "";

  const loglineRow = input.logline?.trim()
    ? `
      <tr><td style="padding:0 0 30px 0;">
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;color:rgba(246,239,228,0.72);">${escapeHtml(input.logline.trim())}</p>
      </td></tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${input.locale === "es" ? "es" : "en"}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]>
<style>table,td{font-family:Arial,Helvetica,sans-serif !important;}</style>
<![endif]-->
<style>
  @media only screen and (max-width:620px){
    .wrap{width:100% !important;}
    .px{padding-left:24px !important;padding-right:24px !important;}
    .hero-title{font-size:40px !important;line-height:42px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#0f0a07;">
<span style="display:none;font-size:1px;color:#0f0a07;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0f0a07;">
<tr><td align="center" style="padding:0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrap" style="width:600px;max-width:600px;">

  <!-- Header -->
  <tr><td class="px" align="center" style="padding:28px 40px 22px 40px;">
    <a href="${input.siteUrl}" style="text-decoration:none;">
      <img src="${wordmarkUrl}" width="102" height="49" alt="MATIO" style="display:block;width:102px;height:49px;border:0;font-family:Arial Black,Arial,Helvetica,sans-serif;font-weight:900;font-size:18px;letter-spacing:6px;color:#e6b366;">
    </a>
  </td></tr>
${heroRow}
  <!-- Episode block -->
  <tr><td class="px" style="padding:34px 40px 0 40px;background-color:#0f0a07;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td align="left" style="padding:0 0 16px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td bgcolor="#8f2f1c" style="background-color:#8f2f1c;border-radius:999px;padding:7px 16px;mso-line-height-rule:exactly;line-height:12px;">
            <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2px;color:#f6efe4;text-transform:uppercase;">${escapeHtml(c.badge)}</span>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 0 6px 0;">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:2px;color:rgba(246,239,228,0.55);text-transform:uppercase;">${escapeHtml(kicker)}</span>
      </td></tr>
      <tr><td style="padding:0 0 14px 0;">
        <h1 class="hero-title" style="margin:0;font-family:Arial Black,Arial,Helvetica,sans-serif;font-weight:900;font-size:48px;line-height:50px;color:#f6efe4;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(title)}</h1>
      </td></tr>${metaRow}${loglineRow}
      <!-- Bulletproof CTA -->
      <tr><td align="left" style="padding:0 0 40px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center" bgcolor="#e6b366" style="background-color:#e6b366;border-radius:999px;mso-line-height-rule:exactly;">
            <a href="${input.watchUrl}" style="display:block;padding:16px 42px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#241205;text-decoration:none;letter-spacing:0.5px;">&#9654;&nbsp;&nbsp;${escapeHtml(c.cta)}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td class="px" align="center" style="padding:30px 40px 44px 40px;border-top:1px solid rgba(168,64,31,0.3);">
    <img src="${wordmarkUrl}" width="84" alt="MATIO" style="display:block;width:84px;height:auto;border:0;margin:0 auto 8px auto;font-family:Arial Black,Arial,Helvetica,sans-serif;font-weight:900;font-size:14px;letter-spacing:5px;color:#e6b366;"><br>
    <span style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:4px;color:#e6b366;text-transform:uppercase;">${escapeHtml(TAGLINE)}</span>
    <p style="margin:18px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:rgba(246,239,228,0.45);">${escapeHtml(c.footerReason(input.showTitle))}<br>
    <a href="${input.unsubscribePageUrl}" style="color:rgba(246,239,228,0.65);text-decoration:underline;">${escapeHtml(c.unsubscribe)}</a></p>
    <p style="margin:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:rgba(246,239,228,0.35);">${escapeHtml(SENDER_LINE)}<br>&copy; ${new Date().getFullYear()} Matio. All rights reserved.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const textMeta = metaParts.length
    ? metaParts.map((p) => p.replace(/&amp;/g, "&")).join(" · ")
    : null;
  const text = [
    `${c.badge.toUpperCase()} — ${kicker}`,
    title.toUpperCase(),
    ...(textMeta ? ["", textMeta] : []),
    ...(input.logline?.trim() ? ["", input.logline.trim()] : []),
    "",
    `${c.cta}: ${input.watchUrl}`,
    "",
    "—",
    c.footerReason(input.showTitle),
    `${c.unsubscribe}: ${input.unsubscribePageUrl}`,
    SENDER_LINE,
  ].join("\n");

  return { subject, html, text };
}
