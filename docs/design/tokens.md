# Juno design tokens

The complete token set the app needs. Every value becomes a CSS variable in one central tokens file; StyleX styles reference the variables and never hard-code a value.

Source tags used throughout:

- **[css]** copied from `docs/design/handoff/prototype/colors_and_type.css`
- **[proto]** extracted from the prototype source (`Threads v3.dc.html`) or measured in a browser with Inter/Instrument Serif loaded
- **[proposed]** our decision; not in the handoff

Where the prototype and SPEC disagree, SPEC wins (see "Spec overrides" at the end).

## 1. Colour

### 1.1 Base palette, light

Warm paper. HSL values are the source of truth; hex is the sRGB result for designers and contrast checks.

| Token | Value | Hex | Source | Used for |
| --- | --- | --- | --- | --- |
| `--background` | `hsla(48, 50%, 98%, 1)` | #FCFBF7 | css | Workspace background, active tab, prompt blocks |
| `--background-subtle` | `hsla(48, 35%, 97%, 1)` | #FAF9F5 | css | Sidebar, tab strip, message hover |
| `--surface-default` | `hsla(48, 30%, 98%, 1)` | #FBFBF8 | css | Popovers, cards, inputs, composer |
| `--surface-hover` | `hsla(48, 30%, 94%, 1)` | #F4F2EB | css | Hover on rows, menu items, icon buttons; send-check bar; segmented control track |
| `--surface-active` | `hsla(48, 30%, 92%, 1)` | #F1EEE4 | css | Reserved (unused in prototype) |
| `--surface-raised` | `hsla(48, 30%, 98%, 1)` | #FBFBF8 | proposed | Selected segment of a segmented control; must read as raised over `--surface-hover` in both themes |
| `--secondary-default` | `hsla(48, 30%, 92%, 1)` | #F1EEE4 | css | Secondary buttons, selected row, selected filter, chips, public context pill, channel tile |
| `--secondary-hover` | `hsla(48, 30%, 90%, 1)` | #EDEADE | css | Secondary button hover |
| `--secondary-active` | `hsla(48, 30%, 88%, 1)` | #EAE6D7 | css | Unread count tag, For you count, pressed state |
| `--border-subtle` | `hsla(48, 30%, 92%, 1)` | #F1EEE4 | css | Topic header rule, list-style row rule, table row rule, card inner rules |
| `--border-default` | `hsla(48, 30%, 91%, 1)` | #EFECE1 | css | Sidebar edge, tab strip edge, menu separators, card-style row border, reaction chips, option buttons |
| `--border-strong` | `hsla(48, 30%, 88%, 1)` | #EAE6D7 | css | Outline buttons (Resolve), Main tag, kbd, scrollbar thumb, @ tag ring |
| `--border-strongest` | `hsla(48, 30%, 82%, 1)` | #DFD9C3 | css | Rename input, stealth pill (dashed), outline button hover |
| `--foreground-default` | `hsla(48, 15%, 12%, 1)` | #23211A | css | Body text, toast background |
| `--foreground-subtle` | `hsla(48, 8%, 35%, 1)` | #605E52 | css | Icons, secondary text, unread preview, pill text |
| `--foreground-muted` | `hsla(48, 5%, 42%, 1)` | #706E66 | **proto** (overrides css 52%) | Meta, time, placeholders, section labels. See 1.6 |
| `--accent-default` | `hsla(48, 30%, 8%, 1)` | #1B180E | css | Ink accent: send button, "new" divider, @you chip, Now chip |
| `--accent-hover` | `hsla(48, 30%, 10%, 1)` | #1F1C11 | css | |
| `--accent-active` | `hsla(48, 30%, 13%, 1)` | #292516 | css | |
| `--accent-foreground` | `hsla(48, 20%, 95%, 1)` | #F5F4F0 | css | Text/icon on accent |
| `--accent-foreground-subtle` | `hsla(48, 20%, 90%, 1)` | #EAE8E0 | css | |
| `--accent-foreground-muted` | `hsla(48, 20%, 70%, 1)` | #BDB8A3 | css | |
| `--selection-background` | `hsla(200, 50%, 80%, 1)` | #B3D4E6 | css | `::selection`; prototype also uses it for the focus ring (see 1.7) |
| `--input-border` | `hsla(48, 14%, 82%, 1)` | #D8D5CB | proto | Composer, text fields, selects, search fields, send-card textarea |

### 1.2 Base palette, dark

A warm-neutral near-black: the same paper seen at night, not a cool system grey. Built in OKLCH at hue 85 and chroma 0.006 (text at hue 90), so every step is one hue and only lightness moves. Three clear layers: the sidebar and tab strip sit lowest (L 0.19), the page above them (0.215), and cards, inputs and the composer on top (0.26); popovers and the hover toolbar go one step higher again (0.33, `--surface-raised`). Borders are two steps above what they sit on, so they still separate. Applied with the `dark` theme classes on `<html>`. Before and after renders of the friendly mock: `docs/design/dark-theme/before.png` (the cool palette the handoff CSS gave) and `after.png`.

| Token | Hex | OKLCH L | Measured | Source |
| --- | --- | --- | --- | --- |
| `--background` | #1B1916 | 0.215 | | redesign |
| `--background-subtle` | #151411 | 0.19 | 1.05:1 under the page | redesign |
| `--surface-default` | #252421 | 0.26 | 1.13:1 over the page | redesign |
| `--surface-hover` | #2D2B28 | 0.29 | 1.31:1 over the sidebar | redesign |
| `--surface-active` | #32302D | 0.31 | | redesign |
| `--surface-raised` | #373532 | 0.33 | 1.43:1 over the page, 1.27:1 over a card | redesign |
| `--secondary-default` | #302F2C | 0.305 | 1.38:1 over the sidebar (selected row) | redesign |
| `--secondary-hover` | #383633 | 0.335 | | redesign |
| `--secondary-active` | #403E3B | 0.365 | | redesign |
| `--border-subtle` | #2B2A27 | 0.285 | 1.22:1 on the page (topic header rule) | redesign |
| `--border-default` | #32302D | 0.31 | 1.40:1 on the sidebar edge, 1.33:1 on the page | redesign |
| `--border-strong` | #3C3A37 | 0.35 | 1.37:1 on a card | redesign |
| `--border-strongest` | #4C4A47 | 0.41 | 1.99:1 on the page | redesign |
| `--input-border` | #464541 | 0.39 | 1.62:1 on the composer | redesign |
| `--foreground-default` | #EEEBE2 | 0.94 | 14.7:1 on the page | redesign |
| `--foreground-subtle` | #C6C4BE | 0.82 | 10.1:1 page, 7.7:1 `--secondary-default`, 6.1:1 `--secondary-active`, 7.0:1 popovers | redesign |
| `--foreground-muted` | #A09E9A | 0.70 | 6.6:1 page, 6.9:1 sidebar, 5.8:1 cards, 5.3:1 hover, 5.0:1 `--secondary-default`, 4.6:1 popovers | redesign |
| `--accent-default` | `hsla(48, 30%, 90%, 1)` #EDEADE | | The ink accent's dark fill | css |
| `--accent-hover` | `hsla(48, 30%, 95%, 1)` | | | css |
| `--accent-active` | `hsla(48, 30%, 99%, 1)` | | | css |
| `--accent-foreground` | `hsla(48, 10%, 2%, 1)` | | | css |
| `--accent-foreground-subtle` | `hsla(48, 10%, 5%, 1)` | | | css |
| `--accent-foreground-muted` | `hsla(48, 10%, 10%, 1)` | | | css |
| `--danger` | #F8767E | 0.72 | 6.6:1 page, 5.8:1 cards (the light red is 3.0:1 on ink) | redesign |
| `--overlay` | `rgba(0, 0, 0, 0.5)` | | | redesign |

Dark-only overrides on other groups: `--tint-resolved-fg` takes 52% of the green instead of 70% (1.5); `--avatar-bg-mix` 32% and `--avatar-fg-mix` 46% instead of 24% / 62% (1.6); the shadows (6); the accent swatches (1.3). `BrowserWindow.backgroundColor` in `apps/desktop/src/main/launch.ts` repeats `--background` for both themes.

The handoff's dark values (`hsla(210, 5%, 8%)` and up, cool and two to three lightness points apart) are kept in the git history; they made the sidebar, page and cards one flat black with invisible borders.

### 1.3 Accents

The accent is a user setting (`AppearanceSettings`, persisted in `launch.json` like the theme and applied before first paint). Coral is the default; the original near-black is "ink". Every accent use goes through the `accent` token group, and each accent is one StyleX theme per colour scheme, because a fill that reads on paper is too dark to glow on ink.

| Token | What it is | Coral light | Coral dark |
| --- | --- | --- | --- |
| `--hl` | The fill: primary button, send, @you chip, Now chip, own bubbles | #CC4628 | #FF8A73 |
| `--hl-fg` | Text on the fill | #FFFFFF | #2A0D06 |
| `--hl-text` | Accent text and icons on paper or a tint: the "new" label, the selected nav item, the subscribed bell | #B4351F | #FF9C87 |
| `--hl-soft` | `color-mix(in oklch, var(--hl) <mix>, var(--background))`: mention-row tint, my reaction, the @ tag | 10% | 14% |
| `--hl-nav` | `color-mix(in oklch, var(--hl) <mix>, var(--background-subtle))`: the selected nav item's fill | 9% | 16% |
| `--hl-rule`, `--hl-ring` | `--hl` at 30% and 45% alpha: the new divider's rule, the mine-reaction ring | | |
| `--focus-ring` | The accent text colour, so the ring meets 4.5:1 on the page (3:1 is the minimum) | #B4351F | #FF9C87 |
| `--selection-background` | `color-mix(in oklch, var(--hl) 28%, var(--background))` | | |

Ink keeps the old grey states: `--hl-nav` is `--secondary-default`, its tint mixes are 9% and 18%, and its focus ring stays the info blue (#008AB3 light, 3.8:1 on paper; `hsla(200, 80%, 65%)` dark).

**What the accent does not touch.** Unread counts, the For you count and the quiet "@" tag on rows stay the soft grey tags (SPEC: "unread counts are soft grey, not black badges"); the "@" tag's background is `--hl-soft`, its text `--foreground-subtle`. Coral is for the primary button, the selected nav item, the user's own @mention chip, the focus ring and text selection.

**Values and measured contrast.** Measured in Chromium from the built gallery (WCAG 2, sRGB; `color-mix()` resolved by the browser). Targets: 4.5:1 for text on the fill, accent text on the page, on the selected nav and on the soft tint, and for body text on the selection; the focus ring is the accent text so it meets the same bar. The fill against the page is information only: Marigold in light is 1.94:1, so a marigold button is identified by its label, never by colour alone. The dark column was measured against the dark palette in 1.2.

| Accent | Theme | Fill | Text on fill | Accent text | Text on fill | Fill vs page (info) | Accent text and ring on page | On selected nav | On soft tint | Body on selection |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Coral | Light | #CC4628 | #FFFFFF | #B4351F | 4.69 | 4.53 | 5.85 | 5.11 | 5.13 | 10.76 |
| Coral | Dark | #FF8A73 | #2A0D06 | #FF9C87 | 7.88 | 7.63 | 8.65 | 7.24 | 7.01 | 9.05 |
| Near-black (ink) | Light | #1B180E | #F5F4F0 | #1B180E | 16.12 | 17.14 | 17.14 | 15.28 | 13.87 | 10.10 |
| Near-black (ink) | Dark | #EDEADE | #060505 | #EDEADE | 16.89 | 14.55 | 14.55 | 11.11 | 12.19 | 9.77 |
| Marigold | Light | #F2A900 | #2B1E00 | #7F5200 | 8.11 | 1.94 | 6.52 | 6.00 | 6.05 | 13.12 |
| Marigold | Dark | #F5B83A | #2B1E00 | #F5B83A | 9.16 | 9.86 | 9.86 | 7.93 | 7.74 | 8.29 |
| Teal | Light | #0B7A75 | #FFFFFF | #096762 | 5.18 | 5.00 | 6.48 | 5.65 | 5.69 | 10.59 |
| Teal | Dark | #45C2BB | #04201E | #5ED0CA | 7.87 | 8.09 | 9.48 | 7.86 | 7.63 | 8.84 |
| Midnight blue | Light | #2E1F64 | #FFFAEB | #2E1F64 | 13.45 | 13.56 | 13.56 | 11.05 | 11.03 | 9.30 |
| Midnight blue | Dark | #B3A5EA | #1A1238 | #BDB0F0 | 7.99 | 7.92 | 8.88 | 7.33 | 7.14 | 8.94 |
| Dark emerald | Light | #00674F | #FFFAEB | #00674F | 6.59 | 6.64 | 6.64 | 5.69 | 5.73 | 9.96 |
| Dark emerald | Dark | #4FC4A1 | #04261B | #63D0AF | 7.50 | 8.14 | 9.33 | 7.67 | 7.45 | 8.88 |
| Claret | Light | #7F1734 | #FFFAEB | #7F1734 | 9.70 | 9.78 | 9.78 | 8.16 | 8.16 | 9.47 |
| Claret | Dark | #F08BA0 | #3B0A18 | #F59DB0 | 7.17 | 7.44 | 8.63 | 7.24 | 6.99 | 9.08 |
| Cyan | Light | #008AB3 | #060505 | #006A8A | 5.12 | 3.84 | 5.92 | 5.27 | 5.27 | 11.22 |
| Cyan | Dark | #5AC6EC | #04212E | #6CCFF2 | 8.50 | 8.96 | 9.89 | 8.01 | 7.79 | 8.52 |

### 1.4 Context tints (public / private / DM)

Always derived from the base palette so they follow dark mode. Formulas from the prototype; hex measured in Chromium.

| Context | Background | Foreground | Light hex (bg / fg) | Dark hex (bg / fg) | Contrast light / dark |
| --- | --- | --- | --- | --- | --- |
| Public channel | `var(--secondary-default)` | `var(--foreground-subtle)` | #F1EEE4 / #605E52 | #302F2C / #C6C4BE | 5.62 / 7.68 |
| Private channel | `color-mix(in oklch, var(--warning) 15%, var(--background))` | `color-mix(in oklch, var(--warning) 42%, var(--foreground-default))` | #F9EEDB / #6C5424 | #342C1C / #EACE9C | 6.24 / 9.07 |
| Direct message, group DM | `color-mix(in oklch, var(--info) 12%, var(--background))` | `color-mix(in oklch, var(--info) 55%, var(--foreground-default))` | #DFEEF5 / #20596F | #1A262B / #7EB7D0 | 6.50 / 7.06 |

Token names [proposed]: `--tint-public-bg/fg`, `--tint-private-bg/fg`, `--tint-dm-bg/fg`.

Used by: topic header context pill, New message To pill, Juno send-card pill. Icons: `hash` (public), `lock` (private), `user` (DM), `users` (group DM).

### 1.5 Status and semantic colours

| Token | Value | Source | Notes |
| --- | --- | --- | --- |
| `--danger` | #C41E3A light, #F8767E dark | css / redesign | Sign-in error line. 5.64:1 on paper, 6.59:1 on ink |
| `--success` | #00674F | css | Resolved check icon in rows; Resolved status chip tint |
| `--warning` | #E0A500 | css | Only ever mixed (private tint, audience guard). As text it is 2.13:1, never use raw |
| `--info` | #008AB3 | css | Only mixed (DM tint). 3.85:1 as text |
| Resolved chip | bg `color-mix(in oklch, var(--success) 12%, var(--background))`, fg `color-mix(in oklch, var(--success) 70%, var(--foreground-default))` light, `52%` dark | proto / redesign | Light #DCE9E4 / #165240 (7.27:1); dark #18231F / #7AA696 (5.94:1; 70% was 4.27:1 on the new palette) |
| Audience guard | bg `color-mix(in oklch, var(--warning) 14%, var(--surface-default))`, fg `color-mix(in oklch, var(--warning) 45%, var(--foreground-default))` | proto | Light #F9EFDE / #725824 (5.88:1); dark #3C3426 / #E9CC96 (7.91:1) |
| Notification decision chips | Now: `--hl` / `--hl-fg`. Digest: `--secondary-default` / `--foreground-subtle`. Silent: transparent / `--foreground-muted` (summary chips use `--surface-hover` instead of transparent) | proto | |
| Mention tint (message that mentions you) | `--hl-soft` on the message row | proto | |
| Traffic lights | #FF5F57, #FEBC2E, #28C840 | proto | Only for mock-ups; Electron draws real ones |
| `--warm` | #E39A3B | friendly layer | Illustration fill only; never text, never a control |
| `--warm-soft` | `color-mix(in oklch, var(--warm) 26%, var(--background))` light (#F8E2CA), `22%` dark (#423221) | friendly layer | The one flat layer inside every spot illustration |
| `--toast-success` | `color-mix(in oklch, var(--success) 55%, var(--background))` light (6.1:1 on the ink toast), `80%` dark (7.1:1 on the paper toast) | friendly layer | The filled check in the resolve toast |

### 1.6 Person colours (avatars)

A person gets one brand hue; the tile derives two colours from it:

- background: `color-mix(in oklch, <hue> 24%, var(--surface-default))` light, `32%` dark
- foreground: `color-mix(in oklch, <hue> 62%, var(--foreground-default))` light, `46%` dark

Dark takes more of the hue in the tile and less in the initials: at 24% a dark hue (midnight, claret) barely tints ink, and at 62% it makes the initials a mid tone on a dark tile (midnight was 3.0:1).

Mention chips (friendly layer): background `color-mix(in oklch, <hue> 16%, var(--surface-default))`, foreground `color-mix(in oklch, <hue> 40%, var(--foreground-default))`, weight 600, the same in both themes. Measured light / dark: cyan 7.8 / 7.0, claret 9.8 / 5.8, midnight 10.5 / 5.3, dark emerald 9.0 / 6.3, plum 6.3 / 7.9, rose 7.1 / 7.4, emerald 6.3 / 7.9, jordy 6.1 / 8.0; lowest 5.3:1 (midnight, dark). Tokens `--person-chip-bg-mix: 16%`, `--person-chip-fg-mix: 40%` beside the avatar mix (`--avatar-bg-mix: 24%` / `32%` dark, `--avatar-fg-mix: 62%` / `46%` dark). The hue is also the default colour of a channel tile (`ChannelIcon`), hashed from the channel id until the user picks another; the user can pick any of the eight.

Hues from the brand palette [proto]: #008AB3 cyan, #7F1734 claret, #2E1F64 midnight, #00674F dark emerald, #E89EB8 plum, #A49496 rose quartz (also bots), #50C878 emerald, #92C2F9 jordy blue.

Measured, light: midnight #C3C2D9 / #28214D (8.5:1), claret #E3C3C6 / #5D1F2C (7.6:1), emerald #D5F0DA / #3F8454 (3.7:1); the light hues (emerald, jordy, plum) fall under 4.5:1 on paper. Dark, with the dark mixes: every hue is 4.5:1 or better (midnight #26243A / #8C89B1 4.5, claret 4.8, cyan 5.3, dark emerald 5.1, plum 5.5, rose 5.4, emerald 5.5, jordy 5.5). Initials are 7.5–14px; acceptable for decorative initials, but do not use the derived foreground for text. [proposed] Assign hues deterministically from a hash of the user id, and skip `--lb-yellow`.

### 1.7 Muted grey contrast (light mode)

`colors_and_type.css` sets `--foreground-muted: hsla(48, 4%, 52%)` (#898880). That is **3.46:1** on `--background` and fails the 4.5:1 body/meta requirement in SPEC §16. The prototype already darkens it at runtime to `hsla(48, 5%, 42%)`.

**Proposed value:** `--foreground-muted: hsla(48, 5%, 42%, 1)` = #706E66.

| On | Light hex | Ratio |
| --- | --- | --- |
| `--background` #FCFBF7 | #706E66 | **4.93:1** |
| `--background-subtle` #FAF9F5 (sidebar) | | 4.82:1 |
| `--surface-hover` #F4F2EB | | 4.56:1 |
| `--secondary-default` #F1EEE4 (count tags, chips) | | 4.39:1 |
| `--secondary-active` #EAE6D7 | | 4.06:1 |

Rule that follows: muted text may sit on `--background`, `--background-subtle`, `--surface-default` and `--surface-hover`. On `--secondary-*` surfaces use `--foreground-subtle` (the prototype already does this for unread count tags, status chips and pills). The read-count tag (muted on `--secondary-default`, 4.39:1) is the one exception; [proposed] use `--foreground-subtle` there too.

Dark mode muted (#A09E9A) is 6.56:1 on the page, 5.8:1 on cards, 4.57:1 on popovers and 5.01:1 on `--secondary-default`, so in dark the rule is not needed, but keep to it so the two themes share one set of pairings.

### 1.8 Focus ring

Prototype: `outline: 2px solid var(--selection-background); outline-offset: 2px` on `:focus-visible`. #B3D4E6 on the light paper is about 1.5:1, below the 3:1 WCAG 2.2 focus-appearance minimum. Decided: `--focus-ring` is the accent text colour (`--hl-text`, 1.3), which is held to 4.5:1 on the page in both themes; `--selection-background` is the accent at 28% over the page and is for text selection only. Both live in the `accent` group so an accent owns them. Ink keeps the info blue it had before.

## 2. Typography

### 2.1 Families

| Token | Value | Source |
| --- | --- | --- |
| `--font-sans` | `'Figtree Variable', 'Figtree', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | decided (replaces Söhne; Inter until the friendly-layer options review) |
| `--font-serif` | `'Instrument Serif', ui-serif, 'Iowan Old Style', Georgia, serif` | proposed (replaces Meraki) |
| `--font-mono` | `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace` | css (PP Neue Montreal Mono dropped) |

Bundle Figtree (variable, `@fontsource-variable/figtree` 5.3.0, Latin subset 20 KB), Instrument Serif 400 regular + italic, JetBrains Mono 400/500 locally; no Google Fonts import.

Root text settings: `font-size: 14.5px; line-height: 1.5; letter-spacing: 0; -webkit-font-smoothing: antialiased`. The prototype root used 0.01em for Inter (`colors_and_type.css` says 0.02em); Figtree's sidebearings are wide enough on their own, so the root and every sans role use 0.

**Metrics differences to expect**

- Figtree's x-height is about 8% smaller than Inter's (0.50em against 0.545em) and it sets about 6% narrower at the same size. So every sans role at or below 15px is half a pixel larger than the prototype's Inter value: the text reads at the same optical size and a line of body text wraps within a character of where Inter did, so the row heights in §5 (measured with Inter) still hold. Sizes above 15px (topic title, the serif roles) are unchanged.
- Figtree's 500 is a true Medium and sits between Inter's 400 and 500; it is right for nav items, filters, buttons and row titles without the `500 → 450` mapping Inter needed. 600 stays for unread titles, names and pills.
- Checked at 12–15px (gallery `Text/all-roles`, light and dark): counters, tags and the 12.5px meta line stay legible; the single-storey g and open a are the main visible change.
- Instrument Serif is more condensed and has a smaller x-height than Meraki. Page titles at 34px look smaller than the handoff screenshots. [proposed] Page titles 36px (Juno empty state 40px) with Instrument Serif. Verify once against a screenshot.
- Enable `font-variant-numeric: tabular-nums` wherever a number is shown (times, counts, table cells). Figtree has `tnum`: measured in Chromium at 12px, "1111" and "0000" are 19.84 / 30.77px proportional and both 29.92px tabular.

### 2.2 Type roles

Sizes are the Figtree values; the prototype's Inter value is half a pixel smaller for every sans role at or below 15px (see 2.1). Letter spacing is 0 for every sans role except the three uppercase labels. Family is sans unless stated.

| Role | Size | Weight | Line height | Letter spacing | Colour | Where |
| --- | --- | --- | --- | --- | --- | --- |
| Section label | 11px | 500 | normal | 0.06em, uppercase | muted | Pinned / Recent / channel groups, popover headings (People, Channels, Recent, Results, Juno) |
| Table header | 11.5px | 500 | normal | 0.06em, uppercase | muted | All topics columns |
| New divider | 11.5px | 600 | normal | 0.06em, uppercase | `--hl` | "3 NEW" |
| Tag | 11.5px | 500 | 18px box | 0 | subtle / muted | Main, Reopened, counts, @, confidence badge, menu hints, ⌘ hints |
| Tag small | 12px | 500 / 400 | | 0 | | Row Resolve button, card footnotes, "Use", Mark read |
| Meta | 12.5px | 400 | normal | 0 | muted | Row line 3, times, message timestamps, card headers, status chips (500), bubble name line, log reasons |
| Pill | 13px | 600 (+400 kind) | 26px box | 0 | tint fg | Context pill, scope chip (500) |
| Small button | 13px | 500 | 28px box | 0 | | Group into topic, Resolve (hint), Fix and send, Stop ignoring, Not yet |
| Thread link | 13px | 400 (count 600) | 26px box | 0 | subtle | "2 replies · Title ›" |
| UI default | 13.5px | 400 / 500 | 1.5 | 0 | default | Nav, menu items, filters, buttons, selects, inputs, toast, table "Where" |
| Preview | 13.5px | 400 | 1.45 | 0 | muted (subtle if unread) | Row line 2, clamped to 1 or 2 lines |
| Body small | 14px | 400 | 1.55–1.6 | 0 | subtle | Catch-up text, For you card body, reply options, picker rows, compact-density message body |
| Body | 14.5px | 400 | 1.6 | 0 | default | Message body (balanced), composer (lh 22px), rule rows, palette labels, textareas |
| Row title | 15px (14 compact) | 500, 600 unread | 22px box | 0 | default | Sidebar row line 1; All topics title is 14.5px |
| Message name | 14.5px | 600 | | 0 | default | Flat message header |
| Body large | 15px | 400 | 1.6 | 0 | | Airy-density message body |
| Heading | 15.5px | 600 | 1.35 | 0 | default | Settings section titles, For you card titles (lh 1.35), palette input (400) |
| Topic title | 20px | 600 | 1.3 | -0.01em | default | Topic header, rename input |
| Page title | serif 34px (32 All topics) | 400 | 1.1–1.15 | 0 | default | New message, For you, Notifications, Preferences, All topics |
| Display | serif 38px | 400 | 1.1 | 0 | default | "What do you need?" |
| Empty title | serif 30px | 400 | | | subtle | "Nothing open" |
| Kbd / confidence | mono 10–11px | 400 | | | subtle / muted | esc, ⌘J, ⌘Z, ↵, "95%" |
| Prompt block | mono 12.5px | 400 | 1.6 | | default | For you coding-agent prompt |
| Avatar initials | 7.5 / 8.5 / 9 / 9.5 / 11 / 12 / 14px | 600 | | | derived | By tile size (18 / 18 / 20 / 24 / 28 / 32 / 44) |

[proposed] Token names: `--text-10-5, --text-11, --text-11-5, --text-12, --text-12-5, --text-13, --text-13-5, --text-14, --text-14-5, --text-15, --text-20, --display-30, --display-32, --display-34, --display-38`. The half-pixel sizes are deliberate in the prototype; keep them rather than rounding, they are what makes the hierarchy quiet.

Line-height tokens: `--leading-title 1.3`, `--leading-card 1.35`, `--leading-preview 1.45`, `--leading-ui 1.5`, `--leading-bubble 1.55`, `--leading-body 1.6`, `--leading-ai 1.65`, `--leading-composer 22px`.

## 3. Spacing

`colors_and_type.css` gives a 4px scale (`--space-1` 4 … `--space-24` 96). The prototype is tuned in 1px and 2px steps. [proposed] One scale with the values actually used:

| Token | px | Typical use |
| --- | --- | --- |
| `--space-0-5` | 2 | Gaps between icon buttons, tab gap, chat-row gap, toolbar padding |
| `--space-1` | 4 | Reaction gap, tag gap, hint padding |
| `--space-1-5` | 6 | Card-style row gap, popover padding, inline gaps |
| `--space-2` | 8 | Nav gap, list padding, header gap, card gap |
| `--space-2-5` | 10 | Menu item padding, pill padding, nav button padding |
| `--space-3` | 12 | Row padding x, card padding, flat message avatar gap |
| `--space-3-5` | 14 | Card padding, header padding y, rule row padding |
| `--space-4` | 16 | Sidebar list bottom, toast inset, table gaps |
| `--space-5` | 20 | Message column top padding, composer bottom |
| `--space-6` | 24 | Message column side padding, composer side padding |
| `--space-7` | 28 | Table side padding |
| `--space-8` | 32 | Topic header left, page padding x |
| `--space-9` | 36 | Settings section gap |
| `--space-10` | 40 | Page padding top |
| `--space-12` | 48 | Empty-state padding |
| `--space-14` | 56 | New message page top |
| `--space-16` | 64 | For you page bottom |
| `--space-18` | 72 | Settings page bottom |

Odd values the prototype uses once (3, 5, 9, 18) are component-local; keep them in the component, not the scale.

## 4. Radii

[css] `--radius-sm 4`, `--radius-md 6`, `--radius-lg 8`, `--radius-xl 10`. The prototype also uses 5, 7, 9, 12, 13, 14, 16 and 999. The friendly layer (`friendly-layer.md` §3) makes every label a pill and gives containers one step more radius; the options review (`friendly-layer/options.html`, D1 "rounder") then took rows and tiles to 16, cards to 20, nav and filter buttons to 12, the composer and the 32px and taller buttons to pills, the hover toolbar to 16 with 12 buttons, and replaced the card and popover rings with wide soft shadows. Full set:

| Token | px | Use |
| --- | --- | --- |
| `--radius-xs` | 4 | Kbd, tiny close buttons, Mark read |
| `--radius-sm` | 5 | Dismiss buttons, segmented-control segment, 18–20px channel tiles |
| `--radius-md` | 6 | Menu items, small buttons (28), quote block, thread link, 24px channel tiles |
| `--radius-md-plus` | 7 | Selects, the segmented track, For you action buttons, topic-list items in Juno cards, 28px channel tiles |
| `--radius-lg` | 8 | 28px buttons, icon buttons (30–32), tabs (top corners), palette items, inputs, send-check bar, option buttons, 28px channel tiles |
| `--radius-xl` | 12 | Nav items, filter buttons, 30px buttons, hover-toolbar buttons (28), To field, New message textarea, 32–36px channel tiles |
| `--radius-2xl` | 14 | Flat message hover row |
| `--radius-3xl` | 16 | Sidebar and list rows (and the selected row), 44px channel tile, hover toolbar |
| `--radius-card` | 20 | Cards (catch-up, grouping, For you, Juno cards) and settings groups |
| `--radius-composer` | 20 | The composer frame: a pill at its 40px single-line height, and the same corner once it has grown, so a tall draft is not a capsule |
| `--radius-menu` | 13 | Context menu, avatar menu, Browse menu, mention popover, To picker |
| `--radius-palette` | 14 | ⌘K panel, user chat bubble (with 4px tail corner) |
| `--radius-toast` | 14 | Toast |
| `--radius-bubble` | 16 | Message bubbles (tail corner 4) |
| `--radius-tag` | 999 | Tags, count badges, @ tag, status chips, decision chips, scope chip, digest chips, stealth pill, confidence badge, reaction chips, inline @person and #channel chips (padding 0 5), the row Resolve button (22) and the toast Undo button (26) |
| `--radius-pill` | 999 | Context pill (header, To field, send card); the 32px and taller buttons (header Resolve, Discard/Send, Sign in) |
| `--radius-full` | 999 | Avatars, attach/send buttons, colour swatches |

A label is a pill; a control or a container is a rounded rectangle. Pills never nest in pills.

**Nesting rule (SPEC §16):** outer radius = inner radius + padding. Pairs: palette 14 = item 8 + padding 6; Juno topics card 20 = item 12 + padding 8 (the items use `--radius-xl`); segmented control 7 = segment 5 + padding 2; menus 13 = item 6 + padding 6 + 1 border; hover toolbar 16 = button 12 + padding 2 + 2 (off by two: the sheet's values, kept so the toolbar matches the rows); card 20 = inset block 8 + padding 12; settings group 20 = row 16 + 4; card row 16 = tile 16 only by eye (the tile is not inset evenly). When building a new container, compute it; do not pick from the table.

## 5. Sizes

All [proto] measured at 1280×800 with Inter unless marked.

### Layout

| Token | Value |
| --- | --- |
| `--sidebar-width` | 384px (fixed, not resizable in v1) |
| `--titlebar-height` | 44px (sidebar top bar and tab strip; both are drag regions) |
| `--tab-height` | 35px, bottom margin -1px so the active tab merges with the page |
| `--tab-width` | flex 0 1 230px, min 72px |
| `--topic-header-height` | 95px at one-line title (padding 14/24/14/32 + 26 pill row + 8 gap + 26 title) |
| `--reading-width` | 800px message column, centred; composer inner max 752px (800 − 2×24) |
| `--page-width-narrow` | 680px (New message) |
| `--page-width` | 720px (For you, Juno) |
| `--page-width-settings` | 760px (Preferences), 880px (Notifications) |
| `--palette-width` | 560px, max calc(100% − 48px), top offset 96px |
| `--menu-width` | 236px context menu, 248px avatar menu, 300px Browse, 280px mention popover |
| `--toast-max-width` | 352px |
| `--scrollbar` | 10px, thumb `--border-strong` with 3px transparent inset, radius 10 |
| `--search-field-width` | 260px filter search; `--keyword-field-width` 160px keyword rule input |
| `--code-block-max-height` | 150px, then the prompt block scrolls inside |

### Controls

| Token | Value | Use |
| --- | --- | --- |
| `--control-18` | 18px | Tags and count badges (implemented as `--control-<px>`; the names below map to `--control-20` … `--control-44`) |
| `--control-xs` | 20px | Tab close, scope chip close, digest chip close |
| `--control-sm` | 22px | Row Resolve button, status chips, dismiss (For you), decision chips |
| `--control-md-` | 24px | Reaction chip, segmented-control segment, summary chips |
| `--control-md` | 26px | Context pill, stealth pill, thread link, toast Undo, rule remove |
| `--control` | 28px | Quick filters, status chips (All topics), small buttons, attach/send, hover-toolbar buttons, To pill, digest chips |
| `--control-lg-` | 30px | Titlebar icon buttons, selects (All topics), card actions, Quote button, empty-state button, context menu item |
| `--control-lg` | 32px | Nav buttons, header icon buttons, Resolve (header), menu items, rule selects, Add |
| `--control-xl-` | 34px | Rename input (header), filter search, suggestion chips, Open notification settings, To-picker rows |
| `--control-xl` | 36px | Discard/Send (New message), topic-list items in Juno cards, reply options (min), title input |
| `--field-min` | 40px | Composer textarea single line (`--composer-padding-block` 9 + `--composer-line-height` 22 + 9), To field 44 |
| `--row-44` / `--row-48` / `--row-52` | 44, 48, 52px | Today log row, notification rule row, All topics table row (ListRow `minHeight`) |

### Tiles and avatars

| Token | Value | Use |
| --- | --- | --- |
| `--tile-lg` | 44px (36 compact) | Sidebar row tile; radius 10 for channels, full for people; initials 14/600 |
| `--avatar-md` | 32px | Flat message avatar; menu header avatar; initials 12 |
| `--avatar-sm` | 28px | Bubble avatar, Juno assistant mark; initials 11 |
| `--avatar-xs` | 24px | Titlebar me avatar; initials 9.5 |
| `--avatar-2xs` | 20px | Mention and To-picker rows; initials 9 |
| `--avatar-3xs` | 18px | Browse rows (8.5), avatar stack (one initial at 8.5, overlap −4, 1.5px ring in the colour of the surface the stack sits on) |

### Icons

Phosphor (`@phosphor-icons/react`, imported per icon). Weight by size: `bold` at 12–14, `regular` at 15–20. `fill` marks active and selected states. `duotone` only for the Juno nav item, AI sparkles, For you card kinds and illustrations. Sizes (`--icon-12` … `--icon-20`): 12 (badges, chip close), 13 (row meta, tags, tab close), 14 (pills, cards, thread link, catch-up sparkle), 15 (tab icon), 16 (nav, menu items, buttons, title sparkle), 18 (icon buttons, hover toolbar, palette rows, send), 20 (attach, palette search). Tab icons sit at 0.75 opacity. There is no stroke token; Phosphor is filled paths and the weight is the variant. The mapping from the Lucide names the prototype used is in `friendly-layer.md` §2.3.

### Illustrations and the mark

`--illustration-list` 96px (sidebar, tables, pickers), `--illustration-workspace` 120px (no tabs), `--illustration-figure` 40px (the seated j alone, Juno chat). Drawn on a 104 by 72 grid at stroke 4 in `--foreground-subtle` with one `--warm-soft` layer; they sit 14px above the empty-state title. The `Logo` primitive draws the laptop-two mark in `currentColor` at 16–44px (the assistant's avatar is 28).

### Rows

Sidebar row heights per density × style × preview lines (chat rows include the tile; measured with Inter, 2-line titles do not occur). The two values are 1-line / 2-line previews.

| Density | chat | list | cards | Vertical padding | Line gap | Title size |
| --- | --- | --- | --- | --- | --- | --- |
| compact | 80 / 99 | 81 / 100 | 86 / 105 | 8px (cards 10) | 1px | 13.5px |
| balanced (default) | 90 / 109 | 91 / 110 | 96 / 115 | 11px (cards 13) | 3px | 14.5px |
| airy | 102 / 121 | 103 / 122 | 108 / 127 | 15px (cards 17) | 5px | 14.5px |

Gap between rows: chat 2px, list 0 (1px rule), cards 6px. All topics table row: min 52px. Notification rule row: min 48px. Today log row: min 44px. Palette result: 55px. Menu item: 30px (context) / 32px (other menus). Message group spacing (margin above a new sender): compact 6px, balanced 12px, airy 18px. Message padding: 2 8 / 4 8 / 6 10.

### Composer

Single line 40px; grows to `max-height` then scrolls inside. Prototype max is 184px (7.5 lines of 22px plus 18px padding). SPEC says "about 8 lines"; [proposed] `--composer-max-height: 194px` (9 + 8×22 + 9). Juno input max 160px.

## 6. Shadows and rings

| Token | Light | Dark | Source | Use |
| --- | --- | --- | --- | --- |
| `--shadow-sm` | `0 1px 2px 0 rgba(27,28,21,.04)` | `0 1px 2px 0 rgba(0,0,0,.30)` | css | Primary button in send-check bar, selected segment |
| `--shadow-md` | `0 2px 6px 0 rgba(27,28,21,.06)` | `0 2px 6px 0 rgba(0,0,0,.40)` | css | Floating Quote button |
| `--shadow-card` | `0 0 12px 0 rgba(27,28,21,.12)` | `0 0 12px 0 rgba(0,0,0,.45)` | css | Unused in prototype; prefer `--card-ring` |
| `--shadow-lg` | `0 8px 24px 0 rgba(27,28,21,.10)` | `0 8px 24px 0 rgba(0,0,0,.50)` | css | Toast |
| `--card-ring` | `0 1px 2px 0 oklch(0 0 0 / .03), 0 6px 20px -4px oklch(0 0 0 / .07)` | `0 1px 2px 0 oklch(0 0 0 / .3), 0 6px 20px -4px oklch(0 0 0 / .35)` | options D1 | Cards: catch-up, grouping, settled hint, For you, Juno cards, settings groups. The name is historical; there is no ring any more |
| `--pop-shadow` | `0 2px 6px -1px oklch(0 0 0 / .05), 0 14px 36px -8px oklch(0 0 0 / .13)` | `0 2px 6px -1px oklch(0 0 0 / .3), 0 14px 36px -8px oklch(0 0 0 / .5)` | options D1 | Menus, popovers, palette, hover toolbar |

Floating surfaces have `border: 1px solid transparent` plus the shadow, never a coloured border. Inputs keep a real 1px `--input-border`. The raised button (`Button variant="raised"`) is a control, not a floating surface: it keeps a 1px `--border-default` edge plus `--shadow-sm`. In dark the shadows alone do not separate a popover from the page, so popovers and the hover toolbar sit on `--surface-raised` (1.2).

## 7. Z-index layers

| Token | Value | Surface |
| --- | --- | --- |
| `--z-toolbar` | 2 | Message hover toolbar (relative to message) |
| `--z-mention` | 5 | @/# suggestion popover above composer |
| `--z-picker` | 10 | New message To picker |
| `--z-menu` | 20 | Avatar menu, Browse menu |
| `--z-palette` | 30 | ⌘K overlay and panel |
| `--z-selection` | 35 | Floating Quote button |
| `--z-context` | 40 | Context menus |
| `--z-toast` | 45 | Toast |

## 8. Motion

Three ideas (`friendly-layer.md` §5): instant for the things you do constantly, a quick ease-out for presses and toggles, and a small spring for the handful of moments that deserve it. Every duration and curve is a token; none is written in a component.

| Token | Value | Use |
| --- | --- | --- |
| `--duration-fast` | 150ms | Press scale, hover colour, focus ring, the avatar photo fade |
| `--duration-pop` | 220ms | Reaction pop, toggle fill, resolve check |
| `--duration-appear` | 240ms | Toast, popover, palette, card and empty-state entrance |
| `--duration-exit` | 150ms | Every exit |
| `--stagger` | 80ms | Between the parts of an empty state as they enter |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Presses, toggles, entrances, exits |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | The three pops only; overshoots about 8% |
| `--press-scale` | 0.96 | On `:active`, never when disabled |
| `--pop-scale` | 1.12 | The peak of a pop |
| `--appear-scale` | 0.98 | Where an entrance starts |
| `--rise-toast`, `--rise-stagger` | 8px, 6px | How far a toast and an empty-state part rise as they enter |
| Transition set | `scale, background-color, color, border-color, box-shadow, opacity` at `--duration-fast` `--ease-out` | |
| Toggle to active | The filled icon scales 0.8 → 1 with the spring over `--duration-pop` and cross-fades from the outline icon; off just cross-fades over `--duration-fast`. Both icons stay in the DOM | |
| Toast | Enter `translateY(--rise-toast)` → 0 with opacity over `--duration-appear`; exit opacity over `--duration-exit`; a replacement cross-fades | |
| Appear | Opacity 0 → 1 and scale `--appear-scale` → 1 over `--duration-appear`, origin at the anchor corner. Exit opacity only | |
| Empty state | Illustration, title, body and action enter `--stagger` apart with opacity and `--rise-stagger`, once, when the state first appears | |
| Theme switch | add `data-theme-switching` on the root; `* { transition: none !important }` while set; remove after two animation frames | |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` through the tokens themselves: every duration and the stagger 0.01ms / 0ms, `--press-scale`, `--pop-scale` and `--appear-scale` 1, the rise distances 0. Opacity cross-fades remain as the visible cue | |
| Hover | Only inside `@media (hover: hover)` | |
| Scroll to new | On open, scroll the "new" divider to 80px below the top, else to the bottom; `requestAnimationFrame` then a 150ms retry | |
| Toast life | 5000ms for undoable, 4000ms for info | |

Entrances are 240ms, exits 150ms, pops 220ms; rows, tabs and typing never animate. Never animated: row hover, selected row, tab switch, tab hover, typing, scrolling, list reorders, nav item hover and active. Only `transform` and `opacity` are animated anywhere.

## 9. Opacity

| Token | Value | Use |
| --- | --- | --- |
| `--opacity-disabled` | 0.4 | Send and Ask buttons with an empty draft, Send on New message |
| `--opacity-dim` | 0.6 | Unsubscribed rows, rows shown while "hidden" |
| `--opacity-tab-icon` | 0.75 | Tab icon |
| `--opacity-kbd` | 0.75 | ⌘Z inside the toast Undo button |

## 10. Spec overrides of the prototype

Apply these when porting; the prototype values are listed so no one copies them by accident.

| Prototype | App |
| --- | --- |
| `cursor: pointer` on every control | Never. Default arrow; text cursor only in editable text |
| `:hover` rules unconditionally | Wrap hover styles in `@media (hover: hover)` |
| Text selectable everywhere | `user-select: none` on chrome; messages, inputs and the prompt block stay selectable |
| `--foreground-muted` 52% L in the CSS file | 42% L (the prototype's runtime override) |
| Focus ring in `--selection-background` | `--focus-ring` = `--info` light, `hsla(200, 80%, 65%)` dark (decided) |
| Cyan accent with off-white text (3.8:1) | Cyan takes near-black `--hl-fg` (`hsla(48, 10%, 2%)`) |
| Composer max 184px | 194px (8 full lines) |
| Söhne / Meraki | Figtree / Instrument Serif, bundled (Inter was the first replacement; swapped for Figtree in the friendly-layer options review) |
| Global letter-spacing 0.02em in CSS file | 0 (Figtree; 0.01em was the Inter value) |
| Lucide outline icons | Phosphor, weight by size, fill for active (`friendly-layer.md` §2) |
| Radius 6 tags, chips, pills and reactions | Pills (`--radius-tag`, `--radius-pill`); rows and tiles 16, cards 20, nav 12, composer 20 (a pill at one line), 32px+ buttons pills, toast 14 |
| No entrances; everything 150ms | Entrances 240ms, exits 150ms, pops 220ms with a spring; rows, tabs and typing still never animate |
