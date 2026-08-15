## Matio conventions (read before building)

**Wrap every design in `MatioTheme`** (a bundle export). Matio is dark-only:
the product ships `<html class="dark">` with three font variables set by
next/font. Outside that wrapper components render on white with serif
fallbacks — visibly broken. `MatioTheme` applies the dark theme, the brand
fonts (Geist / Geist Mono / Anton via `fonts/fonts.css`) and the page
background:

```jsx
import { MatioTheme, Button, Poster } from "matio";

<MatioTheme>
  <div className="mx-auto max-w-md space-y-4">
    <Poster tone="a" title="Thunder Lady" kind="Series" rounded="card" />
    <Button>Watch now</Button>
  </div>
</MatioTheme>
```

**Styling idiom: Tailwind utilities over a fixed brand palette.** Never invent
hex colors — the gold-duotone palette is closed, and every shade below is a
first-class utility (works as `bg-*`, `text-*`, `border-*`, `from-*`, with
opacity modifiers like `border-rust/30`):

| token | hex | use |
|---|---|---|
| `espresso` | #0f0a07 | page background (= `bg-background`) |
| `espresso-2` | #1a120c | raised surfaces, cards, popups |
| `cream` | #f6efe4 | body text on dark (= `text-foreground`); secondary at `/70` |
| `gold` | #e6b366 | primary accent, CTAs |
| `gold-hi` / `gold-lo` | #eec489 / #dfa557 | hover / pressed sides of gold |
| `gold-deep` | #241205 | text ON gold surfaces |
| `burgundy` | #8f2f1c | secondary brand |
| `rust` | #a8401f | warm accent; borders at `/30` |

Semantic aliases exist and are preferred where they read better:
`bg-background`, `text-foreground`, `bg-primary text-primary-foreground`
(gold CTA), `bg-secondary` (burgundy), `text-muted-foreground`.

**Type:** `font-sans` (Geist) for everything; `font-display` (Anton) for
titles — ALWAYS with `uppercase tracking-wide`, single weight; `font-mono`
(Geist Mono) for numbers/data. Headline pattern:
`font-display text-4xl uppercase tracking-wide`.

**Shape language:** pills for actions (`rounded-full` CTAs, e.g.
`h-11 rounded-full bg-gold px-6 text-sm font-extrabold text-gold-deep`),
`rounded-[14px]` for posters (the `rounded="card"` prop), `rounded-2xl` for
popups/cards with `border border-rust/30 bg-espresso-2/95`.

**Breakpoints:** mobile-first; `tablet:` fires at 834px, `xl:` at 1280px —
these two are what the product's CSS actually switches on (plus standard
`sm`/`md`/`lg` if needed).

**Truth lives in** `styles.css` → `_ds_bundle.css` (the full compiled utility
set + tokens) and each component's `.prompt.md`. Read the component docs
before composing: `Poster` needs `tone` (`"a"`–`"f"`, deterministic gradient
placeholders) and takes `imageUrl` only for real artwork; `SocialIcon` takes
`platform` of `tiktok | instagram | youtube | facebook` and inherits color
via `currentColor` from the parent's text class.
