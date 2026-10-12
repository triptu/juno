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

Cool near-black. Applied with `[data-theme="dark"]` on the root.

| Token | Value | Hex | Source |
| --- | --- | --- | --- |
| `--background` | `hsla(210, 5%, 8%, 1)` | #131415 | css |
| `--background-subtle` | `hsla(210, 5%, 9%, 1)` | #161718 | css |
| `--surface-default` | `hsla(210, 5%, 11%, 1)` | #1B1C1D | css |
| `--surface-hover` | `hsla(210, 5%, 13%, 1)` | #1F2123 | css |
| `--surface-active` | `hsla(210, 5%, 15%, 1)` | #242628 | css |
| `--secondary-default` | `hsla(210, 5%, 16%, 1)` | #27292B | css |
| `--secondary-hover` | `hsla(210, 5%, 18%, 1)` | #2C2E30 | css |
| `--secondary-active` | `hsla(210, 5%, 20%, 1)` | #303336 | css |
| `--border-subtle` | `hsla(210, 5%, 12%, 1)` | #1D1F20 | css |
| `--border-default` | `hsla(210, 5%, 15%, 1)` | #242628 | css |
| `--border-strong` | `hsla(210, 5%, 16%, 1)` | #27292B | css |
| `--border-strongest` | `hsla(210, 5%, 21%, 1)` | #333638 | css |
| `--foreground-default` | `hsla(45, 30%, 90%, 1)` | #EDE9DE | css |
| `--foreground-subtle` | `hsla(45, 10%, 80%, 1)` | #D1CFC7 | css |
| `--foreground-muted` | `hsla(45, 2%, 55%, 1)` | #8F8D8A | css (5.57:1 on bg, no override needed) |
| `--accent-default` | `hsla(48, 30%, 90%, 1)` | #EDEADE | css |
| `--accent-hover` | `hsla(48, 30%, 95%, 1)` | #F6F5F0 | css |
| `--accent-active` | `hsla(48, 30%, 99%, 1)` | #FDFDFC | css |
| `--accent-foreground` | `hsla(48, 10%, 2%, 1)` | #060505 | css |
| `--accent-foreground-subtle` | `hsla(48, 10%, 5%, 1)` | #0E0D0B | css |
| `--accent-foreground-muted` | `hsla(48, 10%, 10%, 1)` | #1C1A17 | css |
| `--selection-background` | `hsla(200, 97%, 20%, 1)` | #024364 | css |
| `--input-border` | `hsla(210, 5%, 24%, 1)` | #3A3D40 | proto |

### 1.3 Accent variants (tweak)

The accent is near-black by default. Four optional accents come from the Littlebird brand palette. The prototype exposes them as three derived variables so every accent use goes through `--hl`.

| Token | Default (ink) | Midnight blue | Dark emerald | Claret | Cyan | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `--hl` | `var(--accent-default)` | #2E1F64 | #00674F | #7F1734 | #008AB3 | proto |
| `--hl-fg` | `var(--accent-foreground)` | #FFFAEB | #FFFAEB | #FFFAEB | #FFFAEB | proto |
| `--hl-soft` | `color-mix(in oklch, var(--hl) 9%, var(--background))` | same formula | same | same | same | proto |

Resolved `--hl-soft` for ink: light #E8E2E4, dark #262324 (measured).

Contrast of `--hl-fg` (#FFFAEB) on each accent: ink 17.0, midnight 13.5, emerald 6.6, claret 9.7, **cyan 3.8**. Cyan fails 4.5:1 for small text (the "Now" chip and the send-card Send label are 12–13px). Either drop cyan, or switch `--hl-fg` to `--foreground-default` for cyan. Flagged as an open question.

Accent is used for: send/ask buttons, "N new" divider and its rule (30% alpha), @you mention chip, mine-reaction border (45% alpha), unread dots on Channels/DMs filters, "Now" chips in Notifications, own bubbles in bubble style, the @ badge in Browse, `--hl-soft` tints.

### 1.4 Context tints (public / private / DM)

Always derived from the base palette so they follow dark mode. Formulas from the prototype; hex measured in Chromium.

| Context | Background | Foreground | Light hex (bg / fg) | Dark hex (bg / fg) | Contrast light / dark |
| --- | --- | --- | --- | --- | --- |
| Public channel | `var(--secondary-default)` | `var(--foreground-subtle)` | #F1EEE4 / #605E52 | #27292B / #D1CFC7 | 5.65 / 9.36 |
| Private channel | `color-mix(in oklch, var(--warning) 15%, var(--background))` | `color-mix(in oklch, var(--warning) 42%, var(--foreground-default))` | #F9EFDB / #6D5524 | #2E271A / #E9CD99 | 6.21 / 9.61 |
| Direct message, group DM | `color-mix(in oklch, var(--info) 12%, var(--background))` | `color-mix(in oklch, var(--info) 55%, var(--foreground-default))` | #DFEEF6 / #1F5970 | #172125 / #7CB6D0 | 6.52 / 7.39 |

Token names [proposed]: `--tint-public-bg/fg`, `--tint-private-bg/fg`, `--tint-dm-bg/fg`.

Used by: topic header context pill, New message To pill, Juno send-card pill. Icons: `hash` (public), `lock` (private), `user` (DM), `users` (group DM).

### 1.5 Status and semantic colours

| Token | Value | Source | Notes |
| --- | --- | --- | --- |
| `--danger` | #C41E3A | css | Unused in prototype. 5.66:1 on light bg |
| `--success` | #00674F | css | Resolved check icon in rows; Resolved status chip tint |
| `--warning` | #E0A500 | css | Only ever mixed (private tint, audience guard). As text it is 2.13:1, never use raw |
| `--info` | #008AB3 | css | Only mixed (DM tint). 3.85:1 as text |
| Resolved chip | bg `color-mix(in oklch, var(--success) 12%, var(--background))`, fg `color-mix(in oklch, var(--success) 70%, var(--foreground-default))` | proto | Light #DDEAE4 / #165240 (7.34:1); dark #161E1B / #548E7A (4.48:1, borderline) |
| Audience guard | bg `color-mix(in oklch, var(--warning) 14%, var(--surface-default))`, fg `color-mix(in oklch, var(--warning) 45%, var(--foreground-default))` | proto | |
| Notification decision chips | Now: `--hl` / `--hl-fg`. Digest: `--secondary-default` / `--foreground-subtle`. Silent: transparent / `--foreground-muted` (summary chips use `--surface-hover` instead of transparent) | proto | |
| Mention tint (message that mentions you) | `--hl-soft` on the message row | proto | |
| Traffic lights | #FF5F57, #FEBC2E, #28C840 | proto | Only for mock-ups; Electron draws real ones |

### 1.6 Person colours (avatars)

A person gets one brand hue; the tile derives two colours from it:

- background: `color-mix(in oklch, <hue> 24%, var(--surface-default))`
- foreground: `color-mix(in oklch, <hue> 62%, var(--foreground-default))`

Hues from the brand palette [proto]: #008AB3 cyan, #7F1734 claret, #2E1F64 midnight, #00674F dark emerald, #E89EB8 plum, #A49496 rose quartz (also bots), #50C878 emerald, #92C2F9 jordy blue.

Measured examples: midnight #C3C3D8 / #28224D (8.5:1), claret #E2C3C6 / #5D1F2C (7.6:1), emerald #D5F0DA / #3F8454 (3.7:1). Initials are 7.5–14px; light hues (emerald, jordy, plum, yellow) fall under 4.5:1. Acceptable for decorative initials, but do not use the derived foreground for text. [proposed] Assign hues deterministically from a hash of the user id, and skip `--lb-yellow`.

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

Dark mode muted (#8F8D8A) is 5.57:1 on the background and 4.43:1 on `--secondary-default`; same rule applies.

### 1.8 Focus ring

Prototype: `outline: 2px solid var(--selection-background); outline-offset: 2px` on `:focus-visible`. #B3D4E6 on the light paper is about 1.5:1, below the 3:1 WCAG 2.2 focus-appearance minimum. [proposed] add `--focus-ring: var(--info)` (#008AB3, 3.85:1 light) and dark `hsla(200, 80%, 65%)`; keep `--selection-background` for text selection only. Open question for the owner.

## 2. Typography

### 2.1 Families

| Token | Value | Source |
| --- | --- | --- |
| `--font-sans` | `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | proposed (replaces Söhne) |
| `--font-serif` | `'Instrument Serif', ui-serif, 'Iowan Old Style', Georgia, serif` | proposed (replaces Meraki) |
| `--font-mono` | `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace` | css (PP Neue Montreal Mono dropped) |

Bundle Inter 400/500/600 (variable file is fine), Instrument Serif 400 regular + italic, JetBrains Mono 400/500 locally; no Google Fonts import.

Root text settings [proto]: `font-size: 14px; line-height: 1.5; letter-spacing: 0.01em; -webkit-font-smoothing: antialiased`. Note `colors_and_type.css` says 0.02em globally; the prototype root uses 0.01em and that is what the screenshots show. Use 0.01em.

**Metrics differences to expect**

- Inter has a larger x-height and a wider average character than Söhne. Titles and previews truncate a few characters earlier at the same size. The row heights in §5 were measured with Inter, so they are already correct for what we ship.
- The prototype loaded Söhne only at 400/600/700, so every `font-weight: 500` in the prototype rendered as Söhne 400 when the designer looked at it. With Inter, 500 renders as a true Medium and reads slightly heavier. If the UI feels heavy, map `500 → 450` on the variable font or use 400 for nav items, filters and previews; keep 500 for buttons and row titles.
- Instrument Serif is more condensed and has a smaller x-height than Meraki. Page titles at 34px look smaller than the handoff screenshots. [proposed] Page titles 36px (Juno empty state 40px) with Instrument Serif. Verify once against a screenshot.
- Enable `font-variant-numeric: tabular-nums` wherever a number is shown (times, counts, table cells); Inter supports it.

### 2.2 Type roles

All values [proto] unless noted. Family is sans unless stated.

| Role | Size | Weight | Line height | Letter spacing | Colour | Where |
| --- | --- | --- | --- | --- | --- | --- |
| Section label | 10.5px | 500 | normal | 0.06em, uppercase | muted | Pinned / Recent / channel groups, popover headings (People, Channels, Recent, Results, Juno) |
| Table header | 11px | 500 | normal | 0.06em, uppercase | muted | All topics columns |
| New divider | 11px | 600 | normal | 0.06em, uppercase | `--hl` | "3 NEW" |
| Tag | 11px | 500 | 18px box | 0 | subtle / muted | Main, Reopened, counts, @, confidence badge, menu hints, ⌘ hints |
| Tag small | 11.5px | 500 / 400 | | | | Row Resolve button, card footnotes, "Use", Mark read |
| Meta | 12px | 400 | normal | | muted | Row line 3, times, message timestamps, card headers, status chips (500), bubble name line, log reasons |
| Pill | 12.5px | 600 (+400 kind) | 26px box | | tint fg | Context pill, scope chip (500) |
| Small button | 12.5px | 500 | 28px box | | | Group into topic, Resolve (hint), Fix and send, Stop ignoring, Not yet |
| Thread link | 12.5px | 400 (count 600) | 26px box | | subtle | "2 replies · Title ›" |
| UI default | 13px | 400 / 500 | 1.5 | | default | Nav, menu items, filters, buttons, selects, inputs, toast, table "Where" |
| Preview | 13px | 400 | 1.45 | | muted (subtle if unread) | Row line 2, clamped to 1 or 2 lines |
| Body small | 13.5px | 400 | 1.55–1.6 | | subtle | Catch-up text, For you card body, reply options, picker rows, compact-density message body |
| Body | 14px | 400 | 1.6 | | default | Message body (balanced), composer (lh 22px), rule rows, palette labels, textareas |
| Row title | 14.5px (13.5 compact) | 500, 600 unread | 22px box | 0 | default | Sidebar row line 1; All topics title is 14px |
| Message name | 14px | 600 | | | default | Flat message header |
| Body large | 14.5px | 400 | 1.6 | | | Airy-density message body |
| Heading | 15px | 600 | normal | | default | Settings section titles, For you card titles (lh 1.35), palette input (400) |
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

[css] `--radius-sm 4`, `--radius-md 6`, `--radius-lg 8`, `--radius-xl 10`. The prototype also uses 5, 7, 9, 12, 13, 14, 16 and 999. [proposed] full set:

| Token | px | Use |
| --- | --- | --- |
| `--radius-xs` | 4 | Mention chip, kbd, tiny close buttons, Mark read |
| `--radius-sm` | 5 | Confidence badge, dismiss buttons, segmented-control segment |
| `--radius-md` | 6 | Tags, chips, pills, menu items, small buttons, reactions, quote block, thread link, scope chip |
| `--radius-md-plus` | 7 | Nav buttons, filter buttons, selects, For you action buttons, topic-list items in Juno cards |
| `--radius-lg` | 8 | Icon buttons (30–32), Resolve button, tabs (top corners), flat message hover, palette items, inputs, send-check bar, option buttons |
| `--radius-lg-plus` | 9 | Hover toolbar |
| `--radius-xl` | 10 | Cards, chat/card rows, channel tiles, To field, toast, New message textarea |
| `--radius-2xl` | 12 | Composer |
| `--radius-menu` | 13 | Context menu, avatar menu, Browse menu, mention popover, To picker |
| `--radius-palette` | 14 | ⌘K panel, user chat bubble (with 4px tail corner) |
| `--radius-bubble` | 16 | Message bubbles (tail corner 4) |
| `--radius-full` | 999 | Avatars, attach/send buttons |

**Nesting rule (SPEC §16):** outer radius = inner radius + padding. Pairs in the prototype: palette 14 = item 8 + padding 6; Juno topics card 10 = item 7 + padding 4 (off by one, acceptable); segmented control 7 = segment 5 + padding 2; menus 13 ≈ item 6 + padding 6 (prototype is 1px over, use 12 or keep 13); hover toolbar 9 ≈ button 6 + padding 2 (use 8). When building a new container, compute it; do not pick from the table.

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
| `--field-min` | 40px | Composer textarea single line (padding 9 + 22 + 9), To field 44 |

### Tiles and avatars

| Token | Value | Use |
| --- | --- | --- |
| `--tile-lg` | 44px (36 compact) | Sidebar row tile; radius 10 for channels, full for people; initials 14/600 |
| `--avatar-md` | 32px | Flat message avatar; menu header avatar; initials 12 |
| `--avatar-sm` | 28px | Bubble avatar, Juno assistant mark; initials 11 |
| `--avatar-xs` | 24px | Titlebar me avatar; initials 9.5 |
| `--avatar-2xs` | 20px | Mention and To-picker rows; initials 9 |
| `--avatar-3xs` | 18px | Browse rows (8.5), avatar stack (7.5, overlap −4, 1.5px `--background-subtle` ring) |

### Icons

Lucide outline, `background: currentColor` masks in the prototype; in the app use the `lucide-react` components with `stroke="currentColor"`. Sizes used: 11 (badges), 12 (row meta, tags, chevrons), 13 (pill, cards, thread link), 14 (tab, header title sparkle, buttons), 15 (menu items, nav), 16 (icon buttons, hover toolbar, palette rows), 18 (attach, palette search). Tab icons sit at 0.75 opacity.

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
| `--card-ring` | `0 0 0 1px oklch(0 0 0 / .06), 0 1px 2px -1px oklch(0 0 0 / .06), 0 2px 4px 0 oklch(0 0 0 / .04)` | `0 0 0 1px oklch(1 0 0 / .08)` | proto | Cards: catch-up, grouping, settled hint, For you, Juno cards, settings groups |
| `--pop-shadow` | `0 0 0 1px oklch(0 0 0 / .06), 0 1px 2px -1px oklch(0 0 0 / .08), 0 10px 28px -6px oklch(0 0 0 / .14)` | `0 0 0 1px oklch(1 0 0 / .1), 0 8px 24px oklch(0 0 0 / .5)` | proto | Menus, popovers, palette, hover toolbar |

Floating surfaces have `border: 1px solid transparent` plus the ring, never a coloured border. Inputs keep a real 1px `--input-border`.

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

| Token | Value | Source |
| --- | --- | --- |
| `--duration-fast` | 150ms | proto; all hover/press feedback |
| `--ease-out` | ease-out | proto |
| Press | `scale: 0.96` on `:active`, never when disabled | proto / spec |
| Transition set | `scale, background-color, color, box-shadow` at 150ms ease-out | proto |
| Theme switch | add `data-theme-switching` on the root; `* { transition: none !important }` while set; remove after two animation frames | proto |
| Reduced motion | `@media (prefers-reduced-motion: reduce)`: durations 0.01ms, `scale: none` | proto |
| Hover | Only inside `@media (hover: hover) and (pointer: fine)` | spec (prototype uses plain `:hover`) |
| Scroll to new | On open, scroll the "new" divider to 80px below the top, else to the bottom; `requestAnimationFrame` then a 150ms retry | proto |
| Toast life | 5000ms for undoable, 4000ms for info | proto |

No enter/exit animations on menus, popovers, toasts or the palette in the prototype. Keep it that way; if anything is added, cap it at 150ms.

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
| Söhne / Meraki | Inter / Instrument Serif, bundled |
| Global letter-spacing 0.02em in CSS file | 0.01em (prototype root) |
