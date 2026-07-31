# Handoff: Matio — Brand Refresh & Responsive Streaming UI

## Overview
This package documents a visual + brand redesign of **matio**, a short-form original-story streaming service (ES-origin, now **English-first**). It covers the "gold-duotone" brand direction (internally **8a**) applied across mobile, tablet, and desktop, plus a media **player** in three form factors.

The service is **free** — there is no subscription or paywall. The only gate is a lightweight **account sign-up wall** (email only, no card) that appears after a couple of episodes to save watch progress.

The three screens to implement:
- **8a** — Mobile: Home, Show Detail, Sign-up wall
- **9a** — Desktop (1440) & Tablet (834) Home
- **9b** — Player: Desktop/TV (16:9), Phone Landscape, Phone Portrait (vertical/TikTok-style)

## About the Design Files
The bundled file **`Matio Mobile Redesign.dc.html`** is a **design reference created in HTML** — a prototype showing intended look and behavior, **not production code to copy directly**. It contains the full design-exploration history across many turns; the **only turns to implement are `8a`, `9a`, and `9b`** (each screen is a `<div data-screen-label="...">` you can search for). Ignore all other turns (`current`, `1x`–`7x`, `5x`, `6x`, `7x`) — they are superseded history.

Your task is to **recreate the 8a/9a/9b designs in the target codebase's existing environment** (the original app is Next.js + React + Tailwind — see the `efymd9/matio` repo) using its established components and patterns. If starting fresh, React + Tailwind is the recommended stack. Do not ship the HTML directly.

To view the reference: open the HTML file in a browser. It's a horizontally-scrolling canvas; find the `8a`, `9a`, `9b` badges.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, and layout are all intentional and should be recreated pixel-faithfully, adapted to the codebase's component library. Copy text is final (English).

---

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| `bg` (near-black espresso) | `#0f0a07` | App background |
| `bg-elevated` (card) | `#1a120c` | Episode cards, panels |
| `ink` (cream) | `#f6efe4` | Primary text / "on-dark" |
| `ink-muted` | `rgba(246,239,228,0.72)` | Body copy |
| `ink-dim` | `rgba(246,239,228,0.45–0.55)` | Meta, captions |
| `gold` | `#e6b366` | Primary accent, headings, active |
| `gold-hi` / `gold-lo` (CTA gradient) | `#eec489` → `#dfa557` | Primary button `linear-gradient(180deg,...)` |
| `gold-deep` (text on gold) | `#241205` | Label/icon color on gold CTAs |
| `burgundy` | `#8f2f1c` | Secondary accent, badges, ranking #2/#3 |
| `rust` | `#a8401f` | Tertiary accent: dividers, dots, progress fills, glows |
| `poster-fallback` (thriller) | `linear-gradient(160deg,#5c2416,#170905)` | Missing-art poster |

**Duotone treatment (signature look):** every photographic still gets an overlay `linear-gradient(160deg, rgba(230,179,102,0.2), rgba(143,47,28,0.3))` with `mix-blend-mode: overlay`. Poster/hero art uses the same at ~0.18/0.26. This is what makes the catalog feel art-directed — apply it to *all* imagery.

**Ambient glow:** mobile heroes and walls carry a burgundy floor glow: `radial-gradient(ellipse at ~20% 108%, rgba(143,47,28,0.5), transparent ~50%)`. **Do not use it on the desktop hero** — it was removed there by design.

### Typography
- **Display / headings:** **Anton** (Google Fonts), weight 400, `text-transform: uppercase`, `letter-spacing: 0.01em` for titles / `0.12em` for section headers. Titles use tight `line-height: 0.98–1.0`.
- **UI / body:** **Geist** (400–800).
- **Numeric / mono:** **Geist Mono** (timecodes, playback speed).
- Type scale (px): hero title mobile 46 / tablet 62 / desktop 84; section header 16 (mobile) → 20 (desktop); body 13–16; meta 10–12.

### Radius
- CTAs & pills: `999px` (fully rounded — this was an explicit design decision).
- Cards / posters: `14–16px`.
- Circular icon buttons: `999px`.

### Shadows
- Poster: `0 14px 30px -14px rgba(0,0,0,0.8)` (+ `0 0 0 1px` hairline where noted).
- Ranking poster: `0 18px 40px -16px rgba(0,0,0,0.8)`.
- Gold CTA: `0 16px 40px -14px rgba(230,179,102,0.5)`.
- Screen frame: `0 0 0 1px rgba(255,255,255,0.10), 0 30px 80px -30px rgba(0,0,0,0.8)` (presentation only — not part of the app).

### Spacing
Base rhythm of 4px. Screen padding: mobile 20–24px, tablet 32px, desktop 48px. Row gaps: 34–52px between catalog rows.

---

## Screens / Views

### 8a — Mobile (390px wide)

**Home**
- **Header** (absolute, over hero, gradient scrim top): logo lockup (mark + `MATIO` in Anton gold) left; right cluster = `EN` language pill, profile circle. Pills are `999px`, translucent cream `rgba(246,239,228,0.08)` + blur.
- **Hero** (full-bleed poster, 640px tall, content bottom-aligned): burgundy pill badge "Original · Premiere"; Anton title "Quédate Conmigo" (2 lines, 46px); meta row `Thriller · 6 episodes · 16+` separated by 3px rust dots; button row = gold **Watch free** pill (play glyph + label, flex:1) + 52px circular translucent-burgundy "more info" button; 3-dot carousel indicator.
- **Rows:** each row = header (2px rust tick + Anton uppercase label) then horizontal scroller.
  - **Continue watching** — 16:9 cards (220px), centered play button in burgundy circle, bottom **progress bar** (rust fill on translucent track), title + "Ep. N" below.
  - **Top 3 in Spain** — oversized Anton rank numeral (104px; #1 gold, #2/#3 burgundy) with the numeral tucked *behind* a 2:3 poster (`margin-right:-14px`, z-index layering).
  - **Just released** — 2:3 posters (148px) with burgundy "New" pill top-left.
- **Footer:** `MATIO` wordmark, tagline "Story worlds. One studio." (uppercase, gold, tracked 0.28em), link row (Browse / About / Terms / Privacy / Cookies), copyright. Top border is rust `rgba(168,64,31,0.3)`.

**Show Detail**
- Back + share circular buttons (translucent burgundy) top corners.
- Hero 520px, poster + duotone + top-gradient into bg; badge "Matio Original", Anton title, meta row with rust dots.
- Full-width gold **Play** pill; synopsis paragraph.
- **Episodes** section: cards `#1a120c`, rust hairline border, 16:9 thumb left (duotone, small burgundy play circle), title + description + duration. Unwatched thumbs use the thriller gradient fallback. Copy (final):
  1. **The Window** — "Marina arrives in the city with the wrong suitcase." · 2 min
  2. **The Neighbor** — "Someone is watching her from the building across the street." · 2 min
  3. **White Flowers** — "A gift with no sender appears at her door." · 1 min
  4. **The Call** — "A familiar voice warns her: leave now." · 2 min

**Sign-up wall** (appears after ~Ep. 2)
- Full-bleed still + duotone + heavy bottom scrim + burgundy floor glow.
- Top: back button + "Quédate Conmigo / Ep. 2 · The Neighbor".
- Bottom sheet: burgundy pill "Keep watching free"; Anton "Create your account"; body "Create a free account to keep watching and save your progress across every series."; full-width gold **Create free account** pill; "Already have an account? **Sign in**"; fine print "**No card needed. Just an email.**"

### 9a — Desktop (1440) & Tablet (834) Home
Same system, scaled. Desktop specifics:
- **Persistent top nav** with left-aligned links (Browse active, About), right cluster EN + "Sign in" pill.
- Hero 760px, content in a **left column** (max 680px) with a left-to-right scrim so text stays legible over art; hero title 84px; adds a synopsis line + year to meta.
- Rows use larger cards (Continue 310px 16:9; Top 3 numerals 170px, posters 200px; Just released 186px 2:3, 6 across).
- **3-column footer** (brand / matio links / legal links) + baseline copyright.
- Tablet (834): hero 600px, title 62px, nav condensed, 2-column-ish footer (brand left, links right). Cards scale down (Continue 260px, Top 3 numerals 130px).

### 9b — Player (all devices)
Shared language: pure black base, top scrim + bottom scrim, all controls in translucent-black `999px` circles with blur; **primary transport = gold gradient circle**; **Skip intro** = gold pill; progress = **gold** fill + gold scrubber knob with `0 0 0 4px rgba(230,179,102,0.25)` halo; timecodes in Geist Mono.

- **Desktop/TV (1280×720):** top bar (back + title/subtitle + cast/subtitles/settings icons); centered transport (prev / 92px gold play-pause / next); bottom = Skip-intro pill (right), scrubber, timecode + volume/Episodes/speed/fullscreen cluster.
- **Phone Landscape (844×390):** same, tightened — 68px transport, single-line title, compact bottom cluster.
- **Phone Portrait (390×844, vertical):** TikTok-style. Poster art fills frame; back + subtitles top; "Tap for sound" pill; **bottom-left** = badge + Anton title + "Ep. 1 · The Window · 2 min" + slim progress + timecodes; **bottom-right vertical rail** of circular actions (mute / subtitles / share / episodes-list). No center transport — tap-to-play.

---

## Interactions & Behavior
- **Watch free / Play** → launches the player (9b) at the appropriate form factor for the device/orientation.
- **Carousels** scroll horizontally (momentum on touch; arrow affordance optional on desktop hover).
- **Continue watching** cards resume at stored progress (see State).
- **Sign-up wall** triggers after a threshold of episodes watched while signed-out (design shows it at Ep. 2). Dismiss returns to detail; primary CTA → email sign-up (no payment step).
- **Skip intro** appears during the intro window, then hides.
- **Player controls** auto-hide after ~3s idle, reappear on tap/mouse-move.
- **Progress bar** everywhere uses gold (player) / rust (catalog cards) fills.
- Buttons: hover = slight brightness/scale lift; active = press-in. Hit targets ≥ 44px.

## Responsive Behavior
Single breakpoint system: **mobile < 834 ≤ tablet < 1280 ≤ desktop**. Hero height, title size, card widths, and nav layout step per the 8a/9a specs above. Player picks form factor by viewport **orientation + width**: portrait phone → vertical player; landscape phone/tablet → landscape player; ≥1280 → desktop/TV player.

## State Management
- `watchProgress[showId][episodeId]` → seconds / percentage (drives Continue watching + resume).
- `isAuthed` boolean; `episodesWatchedWhileGuest` counter → triggers sign-up wall at threshold.
- `player`: `{ showId, episodeId, playing, currentTime, duration, muted, rate, showControls }`.
- `locale`: default **en** (was es). Show titles are content data, kept in original language.

## Assets
Show artwork lives in **`assets/shows/`** (copied from the original repo's `public/shows/`):
- `quedate-conmigo-hero.jpg`, `quedate-conmigo-poster.jpg`
- `cartero-mundo-hero.png`, `cartero-mundo-poster.png`
- `juego-de-seduccion-hero.png`, `juego-de-seduccion-poster.png`

Brand logo (final, client-provided) lives in **`assets/brand/`**:
- `matio-wordmark.png` — gold arched "MATIO" wordmark (transparent PNG, 2552×1228). **The only logo shown in headers and footers** (no mark next to it). Header heights: ~17px mobile / 18px tablet / 20px desktop; footer ~15px.
- `matio-mark.png` — dark-red "M" blob mark (transparent PNG, 1043×931). **Not used in page chrome** — reserve for favicon/app icon/avatar.

Asset paths in the HTML read `public/shows/...` and `public/brand/...`; in this bundle they're under `assets/...` — remap to your app's asset pipeline. Shows without art use the thriller gradient fallback. Icons are inline SVG (feather-style, 1.7 stroke) — replace with the codebase's icon set.

Fonts: **Anton**, **Geist**, **Geist Mono** (all Google Fonts).

## Files
- `Matio Mobile Redesign.dc.html` — the design reference (implement turns **8a**, **9a**, **9b** only; search their `data-screen-label`s).
- `support.js` — runtime for the HTML prototype only; **not** for production.
- `assets/shows/` — show artwork.
- `assets/brand/` — final logo PNGs (wordmark + mark).
