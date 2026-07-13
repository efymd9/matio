import "server-only";

// "New episode" reminder email — subject + HTML + text renderer, used by
// the admin send action (app/admin/reminder-actions.ts).
//
// Copy lives HERE, not in lib/i18n/dictionaries.ts: the public dict is a
// universal module bundled into every client, and email strings would be
// dead weight there. Emails render server-side at send time in the locale
// captured on the reminder row (show_reminders.locale).
//
// HTML is a single-column table with inline styles (the only layout that
// survives Outlook/Gmail/Apple Mail alike) on the brand espresso/gold
// palette from app/globals.css. No images — the wordmark is letter-spaced
// text, so nothing depends on remote-image loading (off by default in
// several clients).

type ReminderEmailInput = {
  locale: string; // "es" | "en" (free text from the DB; anything non-"es" renders English)
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string | null;
  watchUrl: string;
  unsubscribePageUrl: string;
};

const COPY = {
  es: {
    subject: (show: string) => `Nuevo episodio de ${show} — ya disponible`,
    preheader: (show: string) =>
      `El siguiente episodio de ${show} ya está listo para ver.`,
    kicker: "Nuevo episodio",
    episodeLabel: (s: number, e: number) => `T${s} · E${e}`,
    body: (show: string) =>
      `Nos pediste que te avisáramos: el siguiente episodio de ${show} ya está disponible.`,
    cta: "Ver ahora",
    footerReason:
      "Recibes este correo porque pediste que te avisáramos del próximo episodio en matio.tv.",
    unsubscribe: "Darse de baja",
  },
  en: {
    subject: (show: string) => `New episode of ${show} — out now`,
    preheader: (show: string) =>
      `The next episode of ${show} is ready to watch.`,
    kicker: "New episode",
    episodeLabel: (s: number, e: number) => `S${s} · E${e}`,
    body: (show: string) =>
      `You asked us to let you know — the next episode of ${show} is now streaming.`,
    cta: "Watch now",
    footerReason:
      "You're getting this because you asked to be notified about the next episode on matio.tv.",
    unsubscribe: "Unsubscribe",
  },
} as const;

// Postal identification in the footer — sender-identification requirement
// (UK PECR / CAN-SPAM); matches the legal pages' sole-trader details.
const SENDER_LINE = "Matvei Dobrovolskii t/a Matio · 221 Derby Road, Nottingham, United Kingdom";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderShowReminderEmail(input: ReminderEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = input.locale === "es" ? COPY.es : COPY.en;
  const label = c.episodeLabel(input.seasonNumber, input.episodeNumber);
  const heading = input.episodeTitle
    ? `${label} — ${input.episodeTitle}`
    : `${label} — ${input.showTitle}`;

  const subject = c.subject(input.showTitle);
  const preheader = c.preheader(input.showTitle);

  const html = `<!doctype html>
<html lang="${input.locale === "es" ? "es" : "en"}">
  <body style="margin:0;padding:0;background-color:#0f0a07;">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0a07;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
            <tr>
              <td align="center" style="padding-bottom:22px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:900;letter-spacing:0.32em;color:#e6b366;">MATIO</span>
              </td>
            </tr>
            <tr>
              <td style="background-color:#1a120c;border:1px solid #3a2a1a;border-radius:16px;padding:34px 30px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;color:#e6b366;">${escapeHtml(c.kicker)}</p>
                <h1 style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.25;font-weight:800;color:#f6efe4;">${escapeHtml(heading)}</h1>
                <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#cfc4b4;">${escapeHtml(c.body(input.showTitle))}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;">
                  <tr>
                    <td style="border-radius:999px;background-color:#e6b366;">
                      <a href="${input.watchUrl}" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;color:#241205;text-decoration:none;border-radius:999px;">${escapeHtml(c.cta)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:24px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a7c69;">
                  ${escapeHtml(c.footerReason)}
                  <a href="${input.unsubscribePageUrl}" style="color:#b3a48e;text-decoration:underline;">${escapeHtml(c.unsubscribe)}</a>
                </p>
                <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#6f6355;">${escapeHtml(SENDER_LINE)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    heading,
    "",
    c.body(input.showTitle),
    "",
    `${c.cta}: ${input.watchUrl}`,
    "",
    "—",
    c.footerReason,
    `${c.unsubscribe}: ${input.unsubscribePageUrl}`,
    SENDER_LINE,
  ].join("\n");

  return { subject, html, text };
}
