# 0002. One open Checkout Session per buyer: an expire-sweep after every create, no idempotency key on the signed-in flow

Date: 2026-09-15
Status: Accepted

## Context

Issue #217 (found by the adversarial review of PR #216): one signed-in buyer
could hold two live, billable Stripe Checkout Sessions and pay twice. The
guards in `prepareAuthCheckout` (an access-granting row in our DB, a live
subscription at Stripe) run at *creation*; two sessions that both passed them
both stay payable. The only thing standing between the buyer and a double
charge was the hour-bucketed idempotency key
`checkout:<userId>:<hour>:<digest>`, and the digest hashed request snapshots
that legitimately change between two tabs: the consent cookie (and with it the
`capi_*` / `ph_consent` sentinels), `capi_ip`, `attr_last_*`, the `resume`
playhead in the return URL, and the `surface` discriminator that separated the
paywall's wallet button from `/checkout`. Four confirmed paths to two keys,
two sessions, two subscriptions. A fifth defect on the same page:
`customers.create` had no key, so two parallel *first* checkouts minted two
Stripe customers, `users.stripe_customer_id` was last-writer-wins, and a
buyer could pay on a customer the row no longer named — no webhook match, the
`cs=` return refusing the mismatch, money taken and no access.

The owner fixed the design direction on 2026-09-11: a deterministic key on
`customers.create`; an invariant "not more than one open session per
customer" enforced with `checkout.sessions.list({customer, status:'open'})`
+ `expire`, independent of any key; clients that survive an expired session;
no claim table in the DB; the guest flow out of scope. Two questions were left
to the PR: whether the residual race of a sweep-then-create needs closing, and
whether `surface` in the digest and `resume` in `return_url` are still needed.

Three shapes of the invariant were compared:

1. **Sweep, then create, keep the key** (the issue's literal wording). Two
   creates in the same instant both list an empty set and both survive — the
   residual race is real, and it is exactly the bug class. Worse, next to a
   sweep the key is actively harmful: Stripe replays the *cached* first
   response for a key — `status: 'open'` included — regardless of what has
   happened to the session since. A single-user flow already breaks it: open
   `/checkout` (S1), go back to the player, tick the wallet box (S2 expires
   S1), the sheet fails, click the card CTA → `/checkout` → the same key →
   S1 comes back, dead, and every "Try again" for the rest of the hour gets
   it again. No response field reveals this; only a `retrieve` would.
2. **Create, then sweep the others, keep the key.** No residual race (see
   below), but the same dead-replay dead-end whenever two different keys have
   crossed — the wallet ↔ `/checkout` walk above.
3. **Create with no key, then expire every other open session of the
   customer; fail closed when the sweep cannot be completed.** Chosen.

## Decision

Both signed-in builders (`createAuthCheckoutSession`,
`createAuthWalletCheckoutSession`) create their session through one helper,
`createSoleOpenSession` in `app/subscribe/actions.ts`:

- `checkout.sessions.create(params)` with **no idempotency key**;
- `checkout.sessions.list({ customer, status: "open", limit: 100 })` and
  `expire` for every session but the one just created; an `expire` that
  fails is followed by a `retrieve`, and only a session that is *still open*
  makes the failure propagate (somebody else closing it first — a parallel
  sweep, the buyer paying in the other tab — is the state wanted);
- if the sweep throws, the new session is expired (best effort) and the error
  propagates: a client secret is handed out only once every other open
  session of that customer is provably gone. Fail closed on the money path.

Create-then-sweep has no same-instant race: each call lists *after* its own
create is committed, so of two concurrent calls the one whose list runs last
necessarily sees the other's session and expires it — once both return, at
most one is open. (Assumption: Stripe's list endpoint reads its primary store;
only the Search API is documented as eventually consistent.)

`customers.create` carries `customer:<userId>`, so parallel first checkouts
converge on one customer and the users write-back converges with them.

Clients: the wallet's confirm error hides the slot and shows one human line
(`checkout.walletFailed`), never re-arming — a new session there would expire
the checkout the buyer is presumably paying in elsewhere. `/checkout` keeps
its session id and, on every return of the tab to the foreground
(`visibilitychange` → visible) and on every `window` `focus`, asks
`checkoutSessionState(sessionId)`; `closed` swaps the iframe for the retry
card (`checkout.expiredBody`); the retry is a reload, i.e. a fresh session,
which in turn closes the newer one elsewhere — the tab the buyer is looking
at is the live one. The probe answers `open` on every uncertainty so it can
never tear down a working form — and it answers only about a session that is
provably the caller's (a signed-in buyer's own Stripe customer, or a guest's
`checkout_claim` cookie as `client_reference_id`); with neither binding it
answers before Stripe is asked, so an anonymous caller cannot make the server
look up arbitrary session ids.

The sweep is paged by re-listing the first page until `has_more` is false
(bounded at ten rounds), not by cursor: every expired session leaves the
`status: 'open'` result set, and a `starting_after` cursor pointing at an
object this loop just removed from the filtered list has no documented
meaning.

`resume` stays in `return_url` (safe now; moving it to DB progress on the
return leg is a separate UX call) and `surface` stays on
`buildCheckoutSessionParams` (it selects the consent pair, it was never the
key). The guest flow keeps its digest key: it has no customer to list by.

## Consequences

- Easier: the invariant no longer depends on any create param staying
  byte-identical; adding a field to the metadata channel can no longer open a
  double-charge path. Two Stripe calls (+N expires) per session creation —
  creations happen on an intentful click / a ticked box, not per wall
  impression.
- Harder: a same-intent double submit is no longer a free replay — the newer
  one wins and the older tab must retry. The clients' `startedRef` guards
  keep this to genuinely separate tabs. `checkout_started` / Meta
  `InitiateCheckout` now fire per creation rather than once per hour-key;
  Meta dedups on the session id, PostHog counts a reload as a new start.
- Accepted residuals: a buyer who pays in tab A and, inside the ~1s before
  Stripe lists the new subscription, creates *and* pays in tab B — the
  mirror's partial unique index refuses the second row and the refund is
  manual; the guest pay-first flow keeps the drift-prone digest key (issue
  #224); a mid-3DS session expired by a newer checkout fails that payment,
  which is the intended outcome; two creates in the same instant can expire
  *each other* (each one's sweep sees the other's session) — zero open
  sessions, both tabs holding a dead secret, which is safe (nobody can pay
  twice) but means neither form works until the buyer acts: the visible tab
  gets no `visibilitychange`, so the `/checkout` probe also runs on `window`
  `focus`, and the wallet learns at confirm; either way the recovery is one
  click on the retry card, never a second charge. Removing the key also
  removed the only brake on session creation for a signed-in buyer: reloads
  of `/checkout` and repeated ticks of the wallet box each mint a session
  (+ list + expire) and a fresh `InitiateCheckout` / `checkout_started` —
  Stripe churn and funnel inflation, not money (issue #227).
- Revisit if: Stripe's `list` stops being read-your-writes consistent; the
  guest flow gains a customer before payment (then it joins the sweep); or
  Stripe adds a first-class "single open session per customer" setting.
