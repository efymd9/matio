# Clerk email templates — Matio variant C ("Quiet minimal")

The eight account emails Clerk sends to viewers, in the owner-picked design
(#276, 23.09.2026): espresso `#0f0a07` ground, gold wordmark, one gold-bordered
box for the thing that matters (the code, the address, the device), the
burgundy hairline, the DEEP ORDINARY LTD footer.

| slug | when a viewer gets it |
|---|---|
| `verification_code` | every sign-up and sign-in — practically all the mail Clerk sends |
| `new_device_sign_in` | a sign-in from a device the account has not used |
| `primary_email_address_changed` | the account's address was changed |
| `account_locked` | 100 failed sign-in attempts in a row |
| `reset_password_code` / `password_changed` / `password_removed` | almost never: a password is not a sign-in factor here |
| `invitation` | never today: nobody is invited |

Each template is `<slug>.html` (the compiled HTML Clerk sends — the `body`
field) plus `<slug>.subject.txt` (one line; strip the trailing newline when
uploading). Only Clerk's own variables for that slug are used, plus
`{{current_year}}`; the only image is
`https://matio.tv/brand/matio-wordmark-email.png` (204×98, shown at 72×35).

## Status: NOT applied

Custom email templates are a **Clerk Pro** feature ($25/mo, $20 billed
annually — clerk.com/pricing, «Custom email templates»). On the free plan the
dashboard answers «Premium feature» on save, so production still sends Clerk's
default layout — carrying our name, logo and support address (see
`docs/services.md` → Clerk → Branding). Paying for Pro is the owner's
decision; tracked in `docs/registry.md` and #276.

## Applying (after Pro)

1. The wordmark must already be served by production:
   `curl -sI https://matio.tv/brand/matio-wordmark-email.png` → 200. It ships
   with the release that carries this directory — an email sent before that
   shows a broken image.
2. Keep a copy of what production has now (rollback):
   `GET https://api.clerk.com/v1/templates/email` with the prod secret key →
   save the JSON to a `0600` file outside the repo.
3. Check each template renders with the instance's real settings — render
   only, nothing is saved or sent:
   `POST /v1/templates/email/<slug>/preview` with `{"subject": …, "body": …}`.
   On 23.09.2026 all eight rendered with every variable filled and no `{{…}}`
   left over. Send `User-Agent` explicitly — Cloudflare answers `1010` to
   Python's default one.
4. Apply — dashboard → Customization → Emails → the template → HTML, or the
   Backend API upsert for the same slug. Start with `verification_code`,
   sign in once with a real address, check the mail, then the other seven.
5. Rollback — dashboard «Revert to default», or re-upload the saved copy.

## Checked on 23.09.2026

Rendered by Clerk's preview endpoint; screenshots at 600 px and 375 px with no
horizontal scroll; every text colour ≥ 5.6:1 on its background; table layout,
inline styles, no rgba / SVG / web fonts; buttons (`invitation`,
`new_device_sign_in`) are bulletproof tables with a plain-link fallback.
Open wording points: `invitation` says «1 days» when `expires_in_days` is 1
(Clerk's default does too); `account_locked` assumes `lockout_duration` is a
phrase like «1 hour» (it is, on the current lockout setting of 60 minutes).
