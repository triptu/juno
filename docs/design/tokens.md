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
| `--panel-surface` | `hsla(48, 22%, 95.5%, 1)` | #F6F5F1 | redesign | The Juno panel: a step below the page (1.05:1) and the field on it (1.05:1); muted text 4.7:1 |
| `--panel-bubble` | `hsla(48, 40%, 99%, 1)` | #FDFDFB | redesign | Juno's bubble on the panel, lighter than the panel as the field is (1.07:1) |
| `--secondary-default` | `hsla(48, 30%, 92%, 1)` | #F1EEE4 | css | Secondary buttons, selected row, selected filter, chips, public context pill, channel tile |
| `--secondary-hover` | `hsla(48, 30%, 90%, 1)` | #EDEADE | css | Secondary button hover |
| `--secondary-active` | `hsla(48, 30%, 88%, 1)` | #EAE6D7 | css | The topic switcher's unread count, pressed state |
| `--border-subtle` | `hsla(48, 30%, 92%, 1)` | #F1EEE4 | css | List-style row rule, table row rule, card inner rules |
| `--border-default` | `hsla(48, 30%, 91%, 1)` | #EFECE1 | css | Sidebar edge, tab strip edge, menu separators, card-style row border, reaction chips, option buttons |
| `--border-strong` | `hsla(48, 30%, 88%, 1)` | #EAE6D7 | css | Outline buttons (Resolve), Main tag, kbd, scrollbar thumb, @ tag ring |
| `--border-strongest` | `hsla(48, 30%, 82%, 1)` | #DFD9C3 | css | Rename input, outline button hover |
| `--foreground-default` | `hsla(48, 15%, 12%, 1)` | #23211A | css | Body text, toast background |
| `--foreground-subtle` | `hsla(48, 8%, 35%, 1)` | #605E52 | css | Icons, secondary text, pill text |
| `--foreground-secondary` | `hsla(48, 8%, 28%, 1)` | #4D4B42 | redesign | The middle of a list row's three text levels: the sidebar preview. See 1.7 |
| `--foreground-muted` | `hsla(48, 5%, 42%, 1)` | #706E66 | **proto** (overrides css 52%) | Meta, time, placeholders, section labels. See 1.6 |
| `--foreground-muted-on-fill` | `hsla(48, 8%, 35%, 1)` | #605E52 | redesign | Muted text on a selected row's `--secondary-default` fill. See 1.7 |
| `--accent-default` | `hsla(48, 30%, 8%, 1)` | #1B180E | css | Ink accent: send button, "new" divider, @you chip, Now chip |
| `--accent-hover` | `hsla(48, 30%, 10%, 1)` | #1F1C11 | css | |
| `--accent-active` | `hsla(48, 30%, 13%, 1)` | #292516 | css | |
| `--accent-foreground` | `hsla(48, 20%, 95%, 1)` | #F5F4F0 | css | Text/icon on accent |
| `--accent-foreground-subtle` | `hsla(48, 20%, 90%, 1)` | #EAE8E0 | css | |
| `--accent-foreground-muted` | `hsla(48, 20%, 70%, 1)` | #BDB8A3 | css | |
| `--selection-background` | `hsla(200, 50%, 80%, 1)` | #B3D4E6 | css | `::selection`; prototype also uses it for the focus ring (see 1.7) |
| `--input-border` | `hsla(48, 14%, 82%, 1)` | #D8D5CB | proto | Composer, text fields, selects, search fields, send-card textarea |
| `--tab-strip` | `hsla(48, 26%, 94%, 1)` | #F4F2EC | redesign 10-16 | The tab strip and inactive tabs. 1.08:1 under the active tab, so tabs read apart (inventory 4) |
| `--tab-hover` | `hsla(48, 24%, 90.5%, 1)` | #EDEAE1 | redesign 10-16 | A hovered inactive tab, and the strip's ghost buttons. 1.08:1 over the strip; label `--foreground-subtle` 5.4:1 on it |
| `--tab-divider` | `hsla(48, 14%, 80%, 1)` | #D3D0C5 | redesign 10-16 | The 1px divider between two inactive tabs, 1.38:1 on the strip |
| `--overlay-viewer` | `hsla(48, 50%, 98%, 0.94)` | | redesign | Behind the media viewer: the page at 94%, so only the picture reads |
| `--media-scrim` | `rgba(20, 19, 16, 0.5)` | | media viewer 10-16 | Over a picture: the "+N" on the last tile of a message's grid, and a video's play badge. Not themed: it sits on the picture |
| `--media-scrim-foreground` | `hsla(48, 20%, 98%, 1)` | | media viewer 10-16 | The "+N" and the play glyph on `--media-scrim` |

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
| `--panel-surface` | #201E1B | 0.235 | 1.05:1 over the page, the field 1.07:1 over it | redesign |
| `--panel-bubble` | #2D2B28 | 0.29 | 1.18:1 over the panel (the hover surface) | redesign |
| `--secondary-default` | #302F2C | 0.305 | 1.38:1 over the sidebar (selected row) | redesign |
| `--secondary-hover` | #383633 | 0.335 | | redesign |
| `--secondary-active` | #403E3B | 0.365 | | redesign |
| `--border-subtle` | #2B2A27 | 0.285 | 1.22:1 on the page (row and table rules) | redesign |
| `--border-default` | #32302D | 0.31 | 1.40:1 on the sidebar edge, 1.33:1 on the page | redesign |
| `--border-strong` | #3C3A37 | 0.35 | 1.37:1 on a card | redesign |
| `--border-strongest` | #4C4A47 | 0.41 | 1.99:1 on the page | redesign |
| `--input-border` | #464541 | 0.39 | 1.62:1 on the composer | redesign |
| `--tab-strip` | #0D0C0A | 0.15 | 1.12:1 under the active tab | redesign 10-16 |
| `--tab-hover` | #151411 | 0.19 | 1.06:1 over the strip, 1.05:1 under the page; label 10.6:1 | redesign 10-16 |
| `--tab-divider` | #3A3835 | 0.37 | 1.67:1 on the strip | redesign 10-16 |
| `--foreground-default` | #EEEBE2 | 0.94 | 14.7:1 on the page | redesign |
| `--foreground-subtle` | #C6C4BE | 0.82 | 10.1:1 page, 7.7:1 `--secondary-default`, 6.1:1 `--secondary-active`, 7.0:1 popovers | redesign |
| `--foreground-secondary` | #C0BEB8 | 0.80 | 9.9:1 sidebar, 7.6:1 hover, 7.2:1 `--secondary-default` | redesign |
| `--foreground-muted` | #A09E9A | 0.70 | 6.6:1 page, 6.9:1 sidebar, 5.8:1 cards, 5.3:1 hover, 5.0:1 `--secondary-default`, 4.6:1 popovers | redesign |
| `--foreground-muted-on-fill` | #A09E9A | 0.70 | Same as muted, which passes on the fill in dark | redesign |
| `--accent-default` | `hsla(48, 30%, 90%, 1)` #EDEADE | | The ink accent's dark fill | css |
| `--accent-hover` | `hsla(48, 30%, 95%, 1)` | | | css |
| `--accent-active` | `hsla(48, 30%, 99%, 1)` | | | css |
| `--accent-foreground` | `hsla(48, 10%, 2%, 1)` | | | css |
| `--accent-foreground-subtle` | `hsla(48, 10%, 5%, 1)` | | | css |
| `--accent-foreground-muted` | `hsla(48, 10%, 10%, 1)` | | | css |
| `--danger` | #F8767E | 0.72 | 6.6:1 page, 5.8:1 cards (the light red is 3.0:1 on ink) | redesign |
| `--overlay` | `rgba(0, 0, 0, 0.5)` | | | redesign |
| `--overlay-viewer` | `rgba(27, 25, 22, 0.94)` | | The page (#1B1916) at 94%, behind the media viewer | redesign |

Dark-only overrides on other groups: `--tint-resolved-fg` takes 52% of the green instead of 70% (1.5); `--avatar-bg-mix` 32% and `--avatar-fg-mix` 46% instead of 24% / 62% (1.6); the shadows (6); the accent swatches (1.3). `BrowserWindow.backgroundColor` in `apps/desktop/src/main/launch.ts` repeats `--background` for both themes.

The handoff's dark values (`hsla(210, 5%, 8%)` and up, cool and two to three lightness points apart) are kept in the git history; they made the sidebar, page and cards one flat black with invisible borders.

### 1.3 Accents

The accent is a user setting (`AppearanceSettings`, persisted in `launch.json` like the theme and applied before first paint). Coral is the default; the original near-black is "ink". Every accent use goes through the `accent` token group, and each accent is one StyleX theme per colour scheme, because a fill that reads on paper is too dark to glow on ink.

| Token | What it is | Coral light | Coral dark |
| --- | --- | --- | --- |
| `--hl` | The fill: primary button, send, Now chip, own bubbles | #CC4628 | #FF8A73 |
| `--hl-fg` | Text on the fill | #FFFFFF | #2A0D06 |
| `--hl-text` | Accent text and icons on paper or a tint: the "new" label, the selected nav item | #B4351F | #FF9C87 |
| `--hl-soft` | `color-mix(in oklch, var(--hl) <mix>, var(--background))`: mention-row tint, my reaction, the @ tag | 10% | 14% |
| `--hl-bubble` | `color-mix(in oklch, var(--hl) <mix>, var(--background))`: the owner's bubble in the Juno chat (option B, `docs/design/juno-chat/README.md`), with `--foreground-default` text. Ink mixes 12% and 14% | 16% | 22% |
| `--hl-nav` | `color-mix(in oklch, var(--hl) <mix>, var(--background-subtle))`: the selected nav item's fill | 9% | 16% |
| `--hl-count`, `--hl-count-fg` | The sidebar's counters (row unread counts, the Juno nav count): the accent at reduced brightness. Literal values per accent, below | #F7DED4 / #B3371B | #462E26 / #F8846D |
| `--hl-mention`, `--hl-mention-fg` | The @you chip in a message, held to 6:1. `--hl` and `--hl-fg`, except in light where that pair is under 6:1 (coral, teal, cyan): there the fill is `--hl-text` with white text. Values below | #B4351F / #FFFFFF | #FF8A73 / #2A0D06 |
| `--hl-rule`, `--hl-ring` | `--hl` at 30% and 45% alpha: the new divider's rule, the mine-reaction ring | | |
| `--focus-ring` | The accent text colour, so the ring meets 4.5:1 on the page (3:1 is the minimum) | #B4351F | #FF9C87 |
| `--selection-background` | `color-mix(in oklch, var(--hl) 28%, var(--background))` | | |

Ink keeps the old grey states: `--hl-nav` is `--secondary-default`, its tint mixes are 9% and 18%, and its focus ring stays the info blue (#008AB3 light, 3.8:1 on paper; `hsla(200, 80%, 65%)` dark).

**Sidebar counters** (decided 10-16, the owner: the grey count tags were almost invisible). The row unread counts and the Juno nav count take the accent at reduced brightness: `--hl-count` is the accent mixed into `--background-subtle` in OKLab (16% light, 24% dark, raised until the fill stands 1.2:1 from the sidebar in light and 1.45:1 in dark), and `--hl-count-fg` is the accent's own hue, darkened in light until it reaches at least 4.5:1 on that fill, and in dark dimmed toward the fill while it stays above 5:1. They are literal hex values, computed once (WCAG 2, sRGB):

| Accent | Light fill | Light text | Light contrast | Dark fill | Dark text | Dark contrast |
| --- | --- | --- | --- | --- | --- | --- |
| Coral | #F7DED4 | #B3371B | 4.67:1 | #462E26 | #F8846D | 5.07:1 |
| Ink | #D2D0CB | #1B180E | 11.53:1 | #41403B | #B9B6AB | 5.14:1 |
| Marigold | #F9E1BD | #895A00 | 4.7:1 | #43361F | #DEA213 | 5.15:1 |
| Teal | #D8E4DF | #006E69 | 4.7:1 | #253834 | #38B8B2 | 5.11:1 |
| Midnight | #D5D4DE | #2E1F64 | 9.54:1 | #36333E | #AA9CE0 | 5.03:1 |
| Emerald | #D5E1D8 | #00674F | 5.1:1 | #26392F | #44BA98 | 5.14:1 |
| Claret | #E9D4D3 | #7F1734 | 7.17:1 | #432E2F | #ED889D | 5.16:1 |
| Cyan | #D7E6EA | #006B8F | 4.69:1 | #28393E | #48B6DB | 5.14:1 |

**@you chip** (decided 10-17, the owner: the light coral chip read poorly). White on the coral fill was 4.69:1, and the cyan chip's near-black text on its mid blue 5.12:1: both pass AA but read weakly in body text. The chip takes its own pair, measured (WCAG 2, sRGB) and checked by `apps/gallery/contrast.spec.ts`:

| Accent | Light fill / text | Light contrast | Dark contrast |
| --- | --- | --- | --- |
| Coral | #B4351F / #FFFFFF | 6.05:1 | 7.88:1 |
| Ink | `--hl` / `--hl-fg` | 16.12:1 | 16.89:1 |
| Marigold | `--hl` / `--hl-fg` | 8.11:1 | 9.16:1 |
| Teal | #096762 / #FFFFFF | 6.71:1 | 7.87:1 |
| Midnight | `--hl` / `--hl-fg` | 13.45:1 | 7.99:1 |
| Emerald | `--hl` / `--hl-fg` | 6.59:1 | 7.5:1 |
| Claret | `--hl` / `--hl-fg` | 9.7:1 | 7.17:1 |
| Cyan | #006A8A / #FFFFFF | 6.12:1 | 8.5:1 |

In dark every chip is `--hl` / `--hl-fg`.

Ink stays neutral, as everywhere else. The quick filters show no counts, only the unread dot, so nothing else in the sidebar changes.

**What the accent does not touch.** Counts outside the sidebar (the topic switcher), the tab unread dot and the quiet "@" tag on rows stay the soft grey tags; the "@" tag's background is `--hl-soft`, its text `--foreground-subtle`. Coral is for the primary button, the selected nav item, the sidebar's counters, the user's own @mention chip, the focus ring and text selection.

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

### 1.3a Icon tints

`iconTints` (`--icon-tint-<accent>`, `--icon-tint-neutral`) colour a sidebar view's icon (SPEC 5, Views). Each is its accent's `--hl-text`, light and dark (`darkIconTints` in themes.stylex.ts), so it reads on the sidebar and on a selected pill's `--secondary-default` fill; neutral is `--foreground-muted`, the plain pill icon. An icon needs 3:1 (WCAG 1.4.11); measured, WCAG 2:

| Tint | On sidebar, light | On selected fill, light | On sidebar, dark | On selected fill, dark |
| --- | --- | --- | --- | --- |
| Neutral | 4.82 | 4.39 | 6.89 | 5.01 |
| Coral | 5.74 | 5.22 | 9.08 | 6.60 |
| Near-black (ink) | 16.84 | 15.31 | 15.30 | 11.12 |
| Marigold | 6.41 | 5.83 | 10.35 | 7.52 |
| Teal | 6.37 | 5.79 | 9.96 | 7.24 |
| Midnight blue | 13.32 | 12.11 | 9.33 | 6.78 |
| Dark emerald | 6.53 | 5.93 | 9.80 | 7.12 |
| Claret | 9.60 | 8.73 | 9.06 | 6.59 |
| Cyan | 5.81 | 5.28 | 10.39 | 7.55 |

### 1.4 Context tints (public / private / DM)

Always derived from the base palette so they follow dark mode. Formulas from the prototype; hex measured in Chromium.

| Context | Background | Foreground | Light hex (bg / fg) | Dark hex (bg / fg) | Contrast light / dark |
| --- | --- | --- | --- | --- | --- |
| Public channel | `var(--secondary-default)` | `var(--foreground-subtle)` | #F1EEE4 / #605E52 | #302F2C / #C6C4BE | 5.62 / 7.68 |
| Private channel | `color-mix(in oklch, var(--warning) 15%, var(--background))` | `color-mix(in oklch, var(--warning) 42%, var(--foreground-default))` | #F9EEDB / #6C5424 | #342C1C / #EACE9C | 6.24 / 9.07 |
| Direct message, group DM | `color-mix(in oklch, var(--info) 12%, var(--background))` | `color-mix(in oklch, var(--info) 55%, var(--foreground-default))` | #DFEEF5 / #20596F | #1A262B / #7EB7D0 | 6.50 / 7.06 |

Token names [proposed]: `--tint-public-bg/fg`, `--tint-private-bg/fg`, `--tint-dm-bg/fg`.

Used by: page header context pill, Juno send-card pill. Icons: `hash` (public), `lock` (private), `user` (DM), `users` (group DM).

### 1.5 Status and semantic colours

| Token | Value | Source | Notes |
| --- | --- | --- | --- |
| `--danger` | #C41E3A light, #F8767E dark | css / redesign | Sign-in error line. 5.64:1 on paper, 6.59:1 on ink |
| `--success` | #00674F | css | Resolved check icon in rows; Resolved status chip tint |
| `--presence-active` | #1F9D66 light (3.34:1 on the menu), #34C77B dark (5.59:1 on `--surface-raised`) | friendly layer | The active presence dot. `--success` read grey at 6px (1.78:1 in dark) |
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

**Sidebar row levels.** A row has three text levels: title `--foreground-default`, preview `--foreground-secondary`, place and time `--foreground-muted`. Light subtle sits only 0.06 OKLCH lightness from muted, too close to read as a level, so the preview takes `--foreground-secondary`, which sits midway between the title and the meta in both themes (OKLCH L, light 0.25 / 0.41 / 0.54, dark 0.94 / 0.80 / 0.70). Dark meta cannot go lower: it must keep 4.5:1 on the selected row. On the selected row muted points at `--foreground-muted-on-fill`. Measured in Chromium by the gallery test `contrast.spec.ts` (title / preview / meta):

| Row on | Light | Dark |
| --- | --- | --- |
| Sidebar `--background-subtle` | 15.3 / 8.3 / 4.85 | 15.5 / 9.9 / 6.9 |
| Hover `--surface-hover` | 14.4 / 7.8 / 4.56 | 11.8 / 7.6 / 5.3 |
| Selected `--secondary-default` | 13.9 / 7.5 / 5.6 | 11.2 / 7.2 / 5.0 |

Dark mode muted (#A09E9A) is 6.56:1 on the page, 5.8:1 on cards, 4.57:1 on popovers and 5.01:1 on `--secondary-default`, so in dark the rule is not needed, but keep to it so the two themes share one set of pairings.

### 1.8 Focus ring

Prototype: `outline: 2px solid var(--selection-background); outline-offset: 2px` on `:focus-visible`. #B3D4E6 on the light paper is about 1.5:1, below the 3:1 WCAG 2.2 focus-appearance minimum. Decided: `--focus-ring` is the accent text colour (`--hl-text`, 1.3), which is held to 4.5:1 on the page in both themes; `--selection-background` is the accent at 28% over the page and is for text selection only. Both live in the `accent` group so an accent owns them. Ink keeps the info blue it had before.

Geometry, in `sizes`: `--focus-ring-width` 2px, `--focus-ring-offset` 2px, and `--focus-ring-room`, their sum: how far an outset ring reaches past its element. A box that clips (a scroller, or a row with paint containment) keeps that room around the controls at its edge, through `ringRoom` in `@juno/ui` (padding of the room, taken back by an equal negative margin, so nothing moves). The outset ring also sets `scroll-margin` to the room, so a scroll into view stops with the ring in sight. Items that fill a scroller edge to edge (tabs, list rows, segments) use the inset ring (offset minus the width) and need no room. `apps/gallery/focus-ring.spec.ts` checks it.

### 1.9 Topic art

The `art` group: eight hues (coral 32, amber 72, olive 112, sage 150, teal 185, sky 235, periwinkle 275, plum 320, as OKLCH hue angles) times four roles a recipe may name, and five Tide tones for the placeholder. `@juno/topic-art` writes them as `var(--art-<hue>-<role>)` and `var(--tide-<hue>-<tone>)`, written as `oklch()` so the browser maps chroma into gamut itself. Only the hue angle is shared between light and dark.

A drawing is painted in its topic's pebble hue (`pebbleHue(topicId)`), not the hue the model named, so a list spreads over all eight hues and the art keeps the colour of the pebble it replaces. The art roles are the calm set (`docs/design/topic-art/v3`, `7c-calm-bright`): one chroma per role for every hue, a small lift over round 2, and in dark a step more lightness so the fill no longer reads as a hole. Lightness steps a little by hue: a quarter of `LIFT` in `v3/directions.mjs` on ink and half on the other roles (`LIFT` is amber +0.05, olive +0.04, sage +0.02, teal +0.01, coral 0, sky -0.02, plum -0.03, periwinkle -0.04). The ranges below run over the eight hues; the exact values per hue are in `tokens.stylex.ts` and `themes.stylex.ts`, generated from `v3/directions.mjs`. The two-tone set that shipped first (direction 4, chroma up to 0.14) was too bright; the spread of hues does the work, not chroma.

| Role | Light (L, C) | Dark (L, C) | Use |
| --- | --- | --- | --- |
| `--art-<hue>-ink` | 0.42 to 0.443, 0.035 | 0.775 to 0.797, 0.035 | The line and dark fills, a trace of the hue. 7.3 to 8.0:1 on the sidebar in light, 9.0 to 9.8:1 in dark: under an unread row's preview, far under the title |
| `--art-<hue>-soft` | 0.855 to 0.90, 0.05 | 0.41 to 0.455, 0.042 | The flat area that gives the object mass and carries most of the hue. In dark a quiet surface above the sidebar, not a hole and not a bright block |
| `--art-<hue>-accent` | 0.58 to 0.625, 0.107 to 0.115 | 0.74 to 0.785, 0.10 | One small highlight, 3.4 to 4.2:1 light and 7.8 to 9.4:1 dark, never the only carrier of meaning. Its chroma stays under the unread count's text (0.165 light, 0.146 dark) |
| `--art-<hue>-accent2` | 0.74 to 0.785, 0.07 | 0.60 to 0.645, 0.06 | A second, quieter highlight |
| `--tide-<hue>-base` | 0.905, 0.02 | 0.33, 0.012 | The pebble's ground |
| `--tide-<hue>-soft` | 0.865, 0.028 | 0.37, 0.017 | The upper band of a three-band pebble |
| `--tide-<hue>-mid` | 0.815, 0.036 | 0.415, 0.022 | The middle band |
| `--tide-<hue>-deep` | 0.75, 0.042 | 0.48, 0.026 | The lowest band |
| `--tide-<hue>-pale` | 0.945, 0.012 | 0.48, 0.026 | The dot: a highlight in light, a shadow in dark (it takes the deep value there) |

The dark Tide tones sit 0.045 above the study's (base 0.285 there): on the near-black sidebar (L 0.19) the study's pebbles read too dim. In dark they stay near neutral on purpose (chroma 0.012 to 0.026): at low lightness amber, olive and coral turn to mud at any real chroma, so the bands step in lightness instead.

Checked on 10-17 for the calm roles, and before them the two-tone ones (`docs/design/topic-art/v3`, gallery `Sidebar/Art/every-row` and `TopicArt/Overview/every-hue`, light and dark): the title is 15.0:1 in light and 15.5:1 in dark, an unread preview 8.3:1 and 9.9:1, a read preview (muted) 4.8:1 and 6.9:1. The ink sits between the two previews, as it did before. Coral shares its hue angle with the default coral accent, so a coral drawing can sit beside a coral count; the count stays the stronger of the two (a filled pill, chroma 0.146 to 0.165 against the art's 0.115 at most, on a dot).

Checked before that on 10-15 against the row's text (gallery `TopicRow/Tile/art-and-pebbles`, light and dark). On the sidebar, the title is 15.2:1 in light and 15.5:1 in dark, and the preview 4.8:1 and 6.9:1. The art's ink is 7.6 to 7.8:1 in light and 9.1 to 9.3:1 in dark, the same lightness step from the sidebar in both themes. The pebble bands are 1.25 to 2.15:1 in light and 1.5 to 2.9:1 in dark: further from the sidebar in lightness than in light, but still clearly quieter than the drawings and the text. Lower dark ramps (ground at 0.27 to 0.30) were tried side by side and only read murkier, so the values stay.

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

Sizes are the Figtree values; the prototype's Inter value is half a pixel smaller for every sans role at or below 15px (see 2.1). Letter spacing is 0 for every sans role. Every label is in sentence case (SPEC §17); there are no uppercase labels, so none needs tracking. Family is sans unless stated.

| Role | Size | Weight | Line height | Letter spacing | Colour | Where |
| --- | --- | --- | --- | --- | --- | --- |
| Section label | 11px | 500 | normal | 0 | muted | Pinned / Recent / channel groups, popover headings (People, Channels, Recent, Results, Juno) |
| Table header | 11.5px | 500 | normal | 0 | muted | All topics columns |
| New divider | 11.5px | 600 | normal | 0 | `--hl` | "3 new", and the Juno chat's day label ("Today") in muted |
| Tag | 11.5px | 500 | 18px box | 0 | subtle / muted | Main, Reopened, counts, @, confidence badge, menu hints, ⌘ hints |
| Tag small | 12px | 500 / 400 | | 0 | | Row Resolve button, card footnotes, "Use", Mark read |
| Meta | 12.5px | 400 | normal | 0 | muted | Row line 3, times, message timestamps, card headers, status chips (500), bubble name line, log reasons, the page header's 24px context pill (600) and island buttons (500) |
| Pill | 13px | 600 (+400 kind) | 26px box | 0 | tint fg | Context pill (the header's 24px pill takes the Meta size), scope chip (500) |
| Small button | 13px | 500 | 28px box | 0 | | Resolve (hint), Fix and send, Stop ignoring, Not yet |
| Thread link | 13px | 400 (count 600) | 26px box | 0 | subtle | "2 replies · Title ›" |
| UI default | 13.5px | 400 / 500 | 1.5 | 0 | default | Nav, menu items, filters, buttons, selects, inputs, toast, table "Where" |
| Preview | 13.5px | 400 | 1.45 | 0 | muted (subtle if unread) | Row line 2, one line with an ellipsis |
| Body small | 14px | 400 | 1.55–1.6 | 0 | subtle | Picker rows, Compact message body |
| Body | 14.5px | 400 | 1.6 | 0 | default | Message body (Comfortable), composer (lh 22px), rule rows, palette labels, textareas |
| Row title | 15px (14 compact) | 500, 600 unread | 22px box | 0 | default | Sidebar row line 1; All topics title is 14.5px |
| Message name | 14.5px | 600 | | 0 | default | Flat message header |
| Body large | 15px | 400 | 1.6 | 0 | | Unused since the airy density was removed |
| Heading | 15.5px | 600 | 1.35 | 0 | default | Settings section titles, palette input (400) |
| Topic title | 20px | 600 | 1.3 | -0.01em | default | Unused since the floating header; the header title is 14px 600 (the Body small size at the semibold weight) |
| Page title | serif 34px (32 All topics) | 400 | 1.1–1.15 | 0 | default | Settings sections, All topics |
| Display | serif 38px | 400 | 1.1 | 0 | default | "What do you need?" |
| Greeting | serif 36px | 400 | 1.15 | 0 | default | Home's first line, "Morning, Tushar." (`--text-greeting-*`) |
| Empty title | serif 30px | 400 | | | subtle | "Nothing open" |
| Kbd / confidence | mono 10–11px | 400 | | | subtle / muted | esc, ⌘J, ⌘Z, ↵, "95%" |
| Prompt block | mono 12.5px | 400 | 1.6 | | default | Code in Juno cards |
| Avatar initials | 7 / 7.5 / 8.5 / 9 / 9.5 / 11 / 12 / 14px | 600 | | | derived | By tile size (16 / 18 / 18 / 20 / 24 / 28 / 32 / 44) |

[proposed] Token names: `--text-10-5, --text-11, --text-11-5, --text-12, --text-12-5, --text-13, --text-13-5, --text-14, --text-14-5, --text-15, --text-20, --display-30, --display-32, --display-34, --display-38`. The half-pixel sizes are deliberate in the prototype; keep them rather than rounding, they are what makes the hierarchy quiet.

Line-height tokens: `--leading-title 1.3`, `--leading-card 1.35`, `--leading-preview 1.45`, `--leading-ui 1.5`, `--leading-bubble 1.55`, `--leading-body 1.6`, `--leading-ai 1.65`, `--leading-composer 22px`.

## 3. Spacing

`colors_and_type.css` gives a 4px scale (`--space-1` 4 … `--space-24` 96). The prototype is tuned in 1px and 2px steps. [proposed] One scale with the values actually used:

| Token | px | Typical use |
| --- | --- | --- |
| `--space-pixel` | 1 | Fine padding and alignment |
| `--space-0-5` | 2 | Gaps between icon buttons, tab gap, chat-row gap, toolbar padding |
| `--space-1` | 4 | Reaction gap, tag gap, hint padding |
| `--space-1-5` | 6 | Card-style row gap, popover padding, inline gaps |
| `--space-2` | 8 | Nav gap, list padding, header gap, card gap |
| `--space-2-5` | 10 | Menu item padding, pill padding, nav button padding |
| `--space-3` | 12 | Row padding x, card padding, flat message avatar gap |
| `--space-3-5` | 14 | Card padding, rule row padding |
| `--space-4` | 16 | Sidebar list bottom, toast inset, table gaps |
| `--space-5` | 20 | Message column top padding, composer bottom |
| `--space-6` | 24 | Message column side padding, composer side padding |
| `--space-7` | 28 | Table side padding |
| `--space-8` | 32 | Page padding x, the Juno tab's header row |
| `--space-9` | 36 | Settings section gap |
| `--space-10` | 40 | Page padding top |
| `--space-12` | 48 | Empty-state padding |
| `--space-14` | 56 | Large page spacing |
| `--space-16` | 64 | Page bottom padding |
| `--space-18` | 72 | Settings page bottom |

Odd values the prototype uses once (3, 5, 9, 18) are component-local; keep them in the component, not the scale.

## 4. Radii

[css] `--radius-sm 4`, `--radius-md 6`, `--radius-lg 8`, `--radius-xl 10`. The prototype also uses 5, 7, 9, 12, 13, 14, 16 and 999. The friendly layer (`friendly-layer.md` §3) makes every label a pill and gives containers one step more radius; the options review (`friendly-layer/options.html`, D1 "rounder") then took rows and tiles to 16, cards to 20, nav and filter buttons to 12, the composer and the 32px and taller buttons to pills, the hover toolbar to 16 with 12 buttons, and replaced the card and popover rings with wide soft shadows. Full set:

| Token | px | Use |
| --- | --- | --- |
| `--radius-inline` | 2 | Inline link focus corners |
| `--radius-xs` | 4 | Kbd, tiny close buttons, Mark read |
| `--radius-sm` | 5 | Dismiss buttons, segmented-control segment, 18–20px channel tiles |
| `--radius-md` | 6 | Menu items, small buttons (28), quote block, thread link, 24px channel tiles |
| `--radius-md-plus` | 7 | Selects, the segmented track, topic-list items in Juno cards, 28px channel tiles |
| `--radius-lg` | 8 | 28px buttons, icon buttons (30–32), tabs (top corners), palette items, inputs, send-check bar, option buttons, 28px channel tiles |
| `--radius-xl` | 12 | Nav items, filter buttons, 30px buttons, hover-toolbar buttons (28), 32–36px channel tiles |
| `--radius-2xl` | 14 | Flat message hover row |
| `--radius-3xl` | 16 | Sidebar and list rows (and the selected row), 44px channel tile, hover toolbar |
| `--radius-card` | 20 | Cards (settled hint, Juno cards) and settings groups |
| `--radius-composer` | 20 | The composer frame: a pill at its 40px single-line height, and the same corner once it has grown, so a tall draft is not a capsule |
| `--radius-menu` | 13 | Context menu, avatar menu, mention popover, New chat pickers |
| `--radius-palette` | 14 | ⌘K panel, user chat bubble (with 4px tail corner) |
| `--radius-toast` | 14 | Toast |
| `--radius-bubble` | 16 | Message bubbles (tail corner 4) |
| `--radius-panel` | 18 | The Juno panel: half its 36px header row, so the 28px controls 4px in nest in its corners |
| `--radius-tag` | 999 | Tags, count badges, @ tag, status chips, decision chips, scope chip, confidence badge, reaction chips, inline @person and #channel chips (padding 0 5), the row Resolve button (22) and the toast Undo button (26) |
| `--radius-pill` | 999 | Context pill (header, To field, send card); the 32px and taller buttons (Discard/Send, Sign in); the page header's islands, title button and island buttons |
| `--radius-full` | 999 | Avatars, attach/send buttons, colour swatches |

A label is a pill; a control or a container is a rounded rectangle. Pills never nest in pills.

**Nesting rule (SPEC §16):** outer radius = inner radius + padding. Pairs: palette 14 = item 8 + padding 6; Juno topics card 20 = item 12 + padding 8 (the items use `--radius-xl`); segmented control 7 = segment 5 + padding 2; menus 13 = item 6 + padding 6 + 1 border; hover toolbar 16 = button 12 + padding 2 + 2 (off by two: the sheet's values, kept so the toolbar matches the rows); card 20 = inset block 8 + padding 12; settings group 20 = row 16 + 4; card row 16 = tile 16 only by eye (the tile is not inset evenly). When building a new container, compute it; do not pick from the table.

## 5. Sizes

All [proto] measured at 1280×800 with Inter unless marked.

### Layout

| Token | Value |
| --- | --- |
| `--sidebar-width` | 384px default; the owner drags it between `--sidebar-min-width` 280px and `--sidebar-max-width` 480px. The live width is an inline `width` on the shell's sidebar box, set during the drag, not a token value |
| `--sidebar-resize-hit` | 6px hit area centred on the sidebar edge |
| `--titlebar-lights-inset` | 78px kept free for the traffic lights, in the sidebar bar or, with the sidebar hidden, at the start of the tab strip |
| `--juno-panel-width` | 440px default (a Juno bubble holds about 50 characters a line at 14px); `--juno-panel-min-width` 360 and `--juno-panel-max-width` 640 bound a drag on its edge. Beside the topic it gives way to keep `--juno-panel-topic-min` 480px, down to its minimum; under that it covers the topic (the `Workspace` view's container query repeats min + topic min + two insets, 856px) |
| `--juno-panel-inset` | 8px, the header islands' top gap: the panel's inset from the tab strip, the window edge, the bottom and the topic |
| `--juno-panel-resize-hit` | 8px: the drag area, the gap on the panel's left |
| `--titlebar-height` | 44px (sidebar top bar and tab strip; both are drag regions) |
| `--tab-height` | 35px, bottom margin -1px so the active tab merges with the page |
| `--tab-width` | flex 0 1 230px; `--tab-min-width` 120px (the prototype's 72 fit only the icon and the close button). The strip scrolls sideways once the tabs reach the floor. `--tab-pinned-width` 40px (icon only) |
| `--tab-unread-dot` | 6px round, `--foreground-muted` |
| `--tab-divider-height` | 16px, the divider between two inactive tabs, centred on the tab's height |
| `--header-island-top` | 8px from the top of the topic area (or Juno tab, or panel) to the header islands |
| `--header-island-height` | 36px: a 28px control plus 3px padding and the 1px transparent border |
| `--header-band` | 68px: the band behind the islands, solid `--background` to `--header-band-solid` 44px (the islands' bottom), then fading to transparent. Also the list's `scroll-padding-top` and the scrollbar track's top margin |
| `--header-inset` | 56px top padding of a list that runs under the header (`ScrollArea underHeader`), so at scroll top its first row starts below the band. Replaced `--topic-header-height` (100px) |
| `--reading-width` | 800px message column, centred; composer inner max 752px (800 − 2×24) |
| `--home-width` | 480px: Home's column of item rows and the Ask Juno field |
| `--page-width-narrow` | 680px |
| `--page-width` | 720px (Juno) |
| `--page-width-settings` | 760px: every section of Settings, so the sections share one column and one title edge |
| `--settings-nav-width` | 200px: Settings' list of sections, with the sidebar's 10px inset on both sides; fits "Backup & This Mac" |
| `--palette-width` | 560px, max calc(100% − 48px), top offset 96px |
| `--palette-list-max-height` | 400px; the palette list scrolls within this height |
| `--tour-shot-width` / `--tour-shot-height` | 720px / 480px: a tour screenshot, the window at its minimum size at 1x (the files are 1440 × 960). `--tour-width` 760px is the sheet: the picture and 20px each side. On a short window the picture shrinks by its aspect ratio so the sheet keeps `--tour-chrome-height` 340px for the step's text, the dots, the buttons and the dimmed layer's padding (inventory 1.2) |
| `--tool-row-height` | 56px; a Configure sheet tool row, whose list is seven of them tall |
| `--tooltip-max-width` | 280px; a longer tooltip wraps |
| `--menu-width` | 236px context menu; `--menu-width-account` 248px avatar menu, `--menu-width-browse` 300px, `--menu-width-mention` 280px mention popover, `--menu-width-picker` 340px New chat pickers |
| `--reactors-min-width` | 160px: the narrowest the reaction chip's card of who reacted gets; it grows to `--menu-width` |
| `--sidebar-inset` | 10px: the sidebar's inset on both sides (title bar end, nav, filter row, rows); the list's scrollbar gutter sits inside it on the right |
| `--filter-pill-max-width` | 120px: a sidebar view's name pill; longer names end with an ellipsis (inventory 2.3) |
| `--view-sheet-list-max-height` | 200px: the view sheet's conversation list, which scrolls past it |
| `--toast-max-width` | 352px |
| `--peek-width` | 640px peek popover (about 75 characters of compact message text), 8px right of the sidebar or at a Main message; as tall as its messages, up to the room in the window; never wider than the window has room for |
| `--peek-header-height` | 44px peek header: art, title and where on one line |
| `--destination-list-max-height` | 360px New chat destination lists before scrolling |
| `--popover-max-height` | 400px, and never taller than the window below the title bar (`100vh − --titlebar-height − --space-5`), so the account menu fits at the minimum window size; the content scrolls inside. `--picker-max-height` 300px |
| `--emoji-picker-width` / `--emoji-picker-height` | 314px / 360px. The full emoji picker (`EmojiPicker`): nine 32px cells, 12px and 2px padding, the 10px scrollbar gutter and a 1px border each side, so the search field and the grid share edges. Fixed height; the grid scrolls inside |
| `--scrollbar` | 10px, thumb `--border-strong` with 3px transparent inset, radius 10. `ScrollArea scrollbar="hover"` keeps the thumb transparent until the area is hovered; the 10px gutter stays |
| `--search-field-width` | 260px filter search; `--keyword-field-width` 160px keyword rule input |
| `--all-topics-columns` | All topics table grid: `minmax(200px, 1fr) minmax(0, 150px) 104px 44px 84px` |
| `--all-topics-table-min` | 576px: below it the All topics table scrolls sideways (the columns' minimums, 16px gaps, row and table padding) |
| `--code-block-max-height` | 150px, then the block scrolls inside; the wheel goes on to the page at its edges |
| `--toolbar-clip-margin` | 44px: how far a message row may paint outside its box (the 36px toolbar and its shadow), so the toolbar can sit above the row, or below it when flipped. A plain length: Chromium ignores `calc()` in `overflow-clip-margin` |
| `--toolbar-height` | 36px. The message hover toolbar's height. It straddles the row's top edge, its bottom 2px into the row (the row's top padding less 2px; none in compact), so no header keeps room for it (inventory 6.5). The Main toolbar measures 223px with More (M6b) |
| `--thumb-max-width` / `--thumb-max-height` | 360px / 240px. A lone image thumbnail in a message is scaled by its own aspect ratio inside this box, and the box is sized before the bytes arrive (performance.md 3.3). Several images in a message are one grid of this size, two columns, gap 6. File cards are `--thumb-max-width` wide |
| `--thumb-tile-height` | 117px. A tile of that grid when it has two rows: two rows and the gap fill `--thumb-max-height`. |
| `--filmstrip-thumb` | 56px. A square picture in the media viewer's filmstrip. |
| `--viewer-bar-width` | 560px. The media viewer's header bar: one width for every item, so moving between items never moves its buttons. |

### Controls

| Token | Value | Use |
| --- | --- | --- |
| `--control-18` | 18px | Tags and count badges (implemented as `--control-<px>`; the names below map to `--control-20` … `--control-44`) |
| `--control-xs` | 20px | Tab close, scope chip close, digest chip close |
| `--control-sm` | 22px | Row Resolve button, status chips |
| `--control-md-` | 24px | Reaction chip, segmented-control segment, summary chips |
| `--control-md` | 26px | Context pill, thread link, toast Undo, rule remove |
| `--control` | 28px | Quick filters, status chips (All topics), small buttons, attach/send, hover-toolbar buttons, To pill, digest chips |
| `--control-lg-` | 30px | Titlebar icon buttons, selects (All topics), card actions, Quote button, empty-state button, context menu item |
| `--control-lg` | 32px | Nav buttons, menu items, rule selects, Add |
| `--control-xl-` | 34px | Filter search, suggestion chips, Open notification settings, To-picker rows |
| `--control-xl` | 36px | topic-list items in Juno cards, reply options (min), title input |
| `--field-min` | 40px | Composer textarea single line (`--composer-padding-block` 9 + `--composer-line-height` 22 + 9), To field 44 |
| `--row-44` / `--row-48` / `--row-52` | 44, 48, 52px | Today log row, notification rule row, All topics table row (ListRow `minHeight`) |
| `--row-topic-estimate` | 66px | A sidebar row's content box (title, one-line preview, meta), rounded up to a whole pixel. The row's fixed height is this plus its block padding (88px Comfortable), and it is the exact `contain-intrinsic-size` for rows off screen (performance.md 3.2) |
| `--row-message-estimate` | 56px | The same estimate for message rows off screen (performance.md 3.3): a name line and one body line, without the row's block padding |
| `--row-bubble-estimate` | 38px | The estimate for a Juno chat bubble row off screen: one 22px line with 8px padding above and below |

### Tiles and avatars

| Token | Value | Use |
| --- | --- | --- |
| `--tile-lg` | 44px (36 compact) | Sidebar row tile; radius 10 for channels, full for people; initials 14/600 |
| `--avatar-md` | 32px | Flat message avatar; menu header avatar; initials 12 |
| `--avatar-sm` | 28px | Bubble avatar, Juno assistant mark; initials 11 |
| `--avatar-xs` | 24px | Titlebar me avatar; initials 9.5 |
| `--avatar-2xs` | 20px | Mention and To-picker rows; initials 9 |
| `--avatar-3xs` | 18px | Avatar stack (one initial at 8.5, overlap −4, 1.5px ring in the colour of the surface the stack sits on) |
| `--avatar-16` | 16px | A DM tab's photo in the tab icon slot; initials 7 (`--initials-16`) |
| `--avatar-11` | 11px | A group DM member in a 16px tab icon (`GroupAvatar`); no initial fits, so the photo or the colour alone. In the 44px row tile the members use `--avatar-28` |

### Icons

Phosphor (`@phosphor-icons/react`, imported per icon). Weight by size: `bold` at 12–14, `regular` at 15–20. `fill` marks active and selected states. `duotone` only for the Juno nav item, the Juno mark and illustrations. Sizes (`--icon-12` … `--icon-20`): 12 (badges, chip close), 13 (row meta, tags, tab close), 14 (pills, cards, thread link, catch-up sparkle), 15 (tab icon), 16 (nav, menu items, buttons, title sparkle), 18 (icon buttons, hover toolbar, palette rows, send), 20 (attach, palette search). Tab icons sit at 0.75 opacity; a tab's art or photo dims to the same 0.75 on an inactive tab and comes up to full on hover and on the active tab. There is no stroke token; Phosphor is filled paths and the weight is the variant. The mapping from the Lucide names the prototype used is in `friendly-layer.md` §2.3.

### Juno chat

The `chat` group (`tokens.stylex.ts`). `--owner-bubble-bg` and `--owner-bubble-fg` are the owner bubble's fill and text, set to option B (`--hl-bubble` / `--foreground-default`); the other options are listed beside the group, and switching is a change to those two lines. `--bubble-max-width` 76% (`--bubble-max-width-panel` 85% in the Juno panel), `--bubble-tail` 4px (the last bubble of a group), `--card-max-width` 560px. The status bubble: `--status-dot` 6px, `--status-min-width` 52px, `--status-loop` 1200ms, `--status-pulse-scale` 1.35 (1 under reduced motion), `--status-dot-opacity` 1 (0.6 under reduced motion). `--reaction-offset` 10px is how far a reaction badge sits out over its bubble's top corner. The Juno panel's material: `--panel-fill` is `--panel-surface` (opaque; beside a topic it sits on the page colour alone, so nothing behind it moves and it costs nothing to composite), `--panel-glass` the same at 80% for when it covers the topic, with `--panel-backdrop` `blur(24px) saturate(1.6)`. It carries no accent: a tint of `--hl` read as pink, yellow or purple depending on the accent, and the field and Juno's bubbles were the panel's own colour. `--juno-bubble-bg` is Juno's bubble and the status bubble (`--surface-hover`); the panel sets it to `--panel-bubble`.

### Illustrations and the mark

`--illustration-list` 96px (sidebar, tables, pickers), `--illustration-workspace` 120px (no tabs), `--illustration-figure` 40px (the seated j alone, Juno chat). Drawn on a 104 by 72 grid at stroke 4 in `--foreground-subtle` with one `--warm-soft` layer; they sit 14px above the empty-state title. The `Logo` primitive draws the laptop-two mark in `currentColor` at 16–44px (the assistant's avatar is 28).

### Rows

Sidebar row heights per density (Settings › Appearance; rows include the tile; measured with Inter, 2-line titles do not occur). The two values are 1-line / 2-line previews. The prototype's list and cards styles and its airy density are removed.

| Density | Row | Vertical padding | Line gap | Title size |
| --- | --- | --- | --- | --- |
| Comfortable (default) | 90 / 109 | 11px | 3px | 14.5px |
| Compact | 80 / 99 | 8px | 1px | 13.5px |

[built M10] The `density` group in `tokens.stylex.ts` holds what changes, and `compact` in `themes.stylex.ts` overrides it on `<html>`: `--density-row-padding-block` 11px / 8px, `--density-row-line-gap` (line three's margin) 2px / 0px, `--density-row-tile-zoom` 1 / 0.8182 (the 44px tile drawn at 36px), `--density-row-estimate` (the row's content height and off-screen estimate) `--row-topic-estimate` / 64px, `--density-row-two-line-estimate` (the same for any Main, which has no meta line) `--row-topic-two-line-estimate` 42px / 42px, so those rows are 64px / 58px, `--density-message-padding-block` 4px / 2px, `--density-message-group-gap` 12px / 6px. The title size does not change yet.

Two-line picker row (the topic switcher, New chat's pickers): 44px, a 20px title line (`--text-option-title-leading`) over a 16px meta line (`--text-option-meta-leading`), 4px above and below. Gap between rows: 2px. All topics table row: min 52px. Notification rule row: min 48px. Today log row: min 44px. Palette result: 55px. Menu item: 30px (context) / 32px (other menus). Message group spacing (margin above a new sender): Compact 6px, Comfortable 12px. Message padding: 2 8 / 4 8.

### Privacy mode

`--privacy-blur` 6px (`sizes` group). With `data-privacy` on `<html>`, every element marked `data-sensitive` gets `filter: blur(var(--privacy-blur))` from `global.css` (SPEC section 5, Privacy mode). At 6px a 13px line reads as a soft grey bar: the shape of a line, no letters. Hover never removes it.

### Composer

Single line 40px; grows to `max-height` then scrolls inside. Prototype max is 184px (7.5 lines of 22px plus 18px padding). SPEC says "about 8 lines"; [proposed] `--composer-max-height: 194px` (9 + 8×22 + 9). Juno input max 160px.

## 6. Shadows and rings

| Token | Light | Dark | Source | Use |
| --- | --- | --- | --- | --- |
| `--shadow-sm` | `0 1px 2px 0 rgba(27,28,21,.04)` | `0 1px 2px 0 rgba(0,0,0,.30)` | css | Primary button in send-check bar, selected segment |
| `--shadow-md` | `0 2px 6px 0 rgba(27,28,21,.06)` | `0 2px 6px 0 rgba(0,0,0,.40)` | css | Floating Quote button |
| `--shadow-card` | `0 0 12px 0 rgba(27,28,21,.12)` | `0 0 12px 0 rgba(0,0,0,.45)` | css | Unused in prototype; prefer `--card-ring` |
| `--shadow-lg` | `0 8px 24px 0 rgba(27,28,21,.10)` | `0 8px 24px 0 rgba(0,0,0,.50)` | css | Toast |
| `--card-ring` | `0 1px 2px 0 oklch(0 0 0 / .03), 0 6px 20px -4px oklch(0 0 0 / .07)` | `0 1px 2px 0 oklch(0 0 0 / .3), 0 6px 20px -4px oklch(0 0 0 / .35)` | options D1 | Cards: settled hint, Juno cards, settings groups. The name is historical; there is no ring any more |
| `--pop-shadow` | `0 2px 6px -1px oklch(0 0 0 / .05), 0 14px 36px -8px oklch(0 0 0 / .13)` | `0 2px 6px -1px oklch(0 0 0 / .3), 0 14px 36px -8px oklch(0 0 0 / .5)` | options D1 | Menus, popovers, palette, hover toolbar |
| `--tab-shadow` | `0 -1px 3px -1px oklch(0 0 0 / .08)` | `0 -1px 3px -1px oklch(0 0 0 / .5)` | 10-16 | The active tab lifted out of the strip: up and sideways only, so nothing falls on the page it joins |
| `--panel-shadow` | `0 0 0 1px oklch(0 0 0 / .05), 0 1px 2px 0 oklch(0 0 0 / .04), 0 8px 24px -6px oklch(0 0 0 / .08), 0 24px 56px -12px oklch(0 0 0 / .12)` | `inset 0 0 0 1px oklch(1 0 0 / .06), 0 0 0 1px oklch(0 0 0 / .5), 0 1px 2px 0 oklch(0 0 0 / .3), 0 8px 24px -6px oklch(0 0 0 / .4), 0 24px 56px -12px oklch(0 0 0 / .5)` | 10-16 | The Juno panel floating over the page: a hairline ring, a contact shadow, two wide soft ones; in dark a faint light inner edge |

Floating surfaces have `border: 1px solid transparent` plus the shadow, never a coloured border. Inputs keep a real 1px `--input-border`. The raised button (`Button variant="raised"`) is a control, not a floating surface: it keeps a 1px `--border-default` edge plus `--shadow-sm`. In dark the shadows alone do not separate a popover from the page, so popovers and the hover toolbar sit on `--surface-raised` (1.2). The header islands are the calm exception: `--surface-default` with `--card-ring` in both themes, because they are always on screen and sit on the page, not over another surface.

## 7. Z-index layers

| Token | Value | Surface |
| --- | --- | --- |
| `--z-toolbar` | 2 | Message hover toolbar (relative to message) |
| `--z-header` | 3 | Page header band and islands, over the list that scrolls under them |
| `--z-panel` | 4 | The Juno panel while it covers the topic, over the topic's header |
| `--z-mention` | 5 | @/# suggestion popover above composer |
| `--z-picker` | 10 | Picker overlay |
| `--z-menu` | 20 | Avatar menu, New chat pickers |
| `--z-palette` | 30 | ⌘K overlay and panel |
| `--z-viewer` | 30 | Image viewer, over the whole window (never open with the palette) |
| `--z-selection` | 35 | Floating Quote button |
| `--z-context` | 40 | Context menus |
| `--z-toast` | 45 | Toast |
| `--z-tooltip` | 50 | Tooltip, over everything |

## 8. Motion

Three ideas (`friendly-layer.md` §5): instant for the things you do constantly, a quick ease-out for presses and toggles, and a small spring for the handful of moments that deserve it. Every duration and curve is a token; none is written in a component.

| Token | Value | Use |
| --- | --- | --- |
| `--duration-fast` | 150ms | Press scale, hover colour, focus ring, the avatar photo fade |
| `--duration-pop` | 220ms | Reaction pop, toggle fill, resolve check |
| `--duration-appear` | 240ms | Toast, palette, card and empty-state entrance |
| `--duration-menu-in` | 80ms | Popover and menu entrance: menus come in fast and may leave slower (owner, 10-17) |
| `--duration-exit` | 150ms | Every exit |
| `--delay-pending` | 800ms | How long a send may take before its pending row dims |
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
| Appear | Opacity 0 → 1 and scale `--appear-scale` → 1 over `--duration-appear` (`--duration-menu-in` for popovers and menus), origin at the anchor corner. Exit opacity only | |
| Empty state | Illustration, title, body and action enter `--stagger` apart with opacity and `--rise-stagger`, once, when the state first appears | |
| Theme switch | add `data-theme-switching` on the root; `* { transition: none !important }` while set; remove after two animation frames | |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` through the tokens themselves: every duration and the stagger 0.01ms / 0ms, `--press-scale`, `--pop-scale` and `--appear-scale` 1, the rise distances 0. Opacity cross-fades remain as the visible cue | |
| Hover | Only inside `@media (hover: hover)` | |
| Scroll to new | On open, scroll the "new" divider to 80px below the top, else to the bottom; `requestAnimationFrame` then a 150ms retry | |
| Toast life | 5000ms for undoable, 4000ms for info | |

Menus and popovers enter in 80ms, other entrances in 240ms, exits 150ms, pops 220ms; rows, tabs and typing never animate. Never animated: row hover, selected row, tab switch, tab hover, typing, scrolling, list reorders, nav item hover and active. Only `transform` and `opacity` are animated anywhere.

## 9. Opacity

| Token | Value | Use |
| --- | --- | --- |
| `--opacity-disabled` | 0.4 | Send and Ask buttons with an empty draft |
| `--opacity-dim` | 0.6 | The decorative tile of a resolved or unsubscribed row. Never on text: at 0.6 muted text drops to 2.3:1 |
| `--opacity-tab-icon` | 0.75 | Tab icon |
| `--opacity-kbd` | 0.75 | ⌘Z inside the toast Undo button |

## 9a. Two-copy content

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--show-light` | `block` | `none` | `display` of the light copy of content made in both themes: the tour's screenshots |
| `--show-dark` | `none` | `block` | `display` of the dark copy |

Both copies are in the page and the theme picks one, so the view never knows the theme and a theme change swaps them in the same frame as the colours.

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

### Inline and empty-chat measurements

| Token | Value | Use |
| --- | --- | --- |
| `--inline-em` | 1em | Inline checkbox size and vertical divider minimum |
| `--link-underline-offset` | 0.12em | Rich-text link underline |
| `--chat-empty-width` | 520px | Empty chat and missing-provider content |

Raw zero, percentages and 1px border/outline hairlines are allowed in StyleX.
Other literal lengths and colours require tokens, or a trailing
`// tokens-allow: reason` for geometry such as border overlap or pixel rounding.

### Stable metadata

| Token | Value | Used for |
| --- | --- | --- |
| `--topic-time-width` | 48px | Stable relative-time slot in topic rows: at least this wide, the time aligned to its end, so every time ends at the row's trailing inset. |
| `--threads-button-width` | 128px | Threads button before and after its count arrives. |
| `--threads-button-narrow-width` | 64px | Threads button below the header's 480px breakpoint. |
