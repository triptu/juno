/**
 * Juno design tokens. The only place a colour, size, radius, shadow, font or
 * duration is written down.
 *
 * Light values come from docs/design/handoff/prototype/colors_and_type.css,
 * measured prototype values and the decisions in docs/design/tokens.md. The
 * dark theme and the accent themes live in themes.stylex.ts.
 *
 * Every key starts with `--`, so StyleX emits a CSS variable with exactly that
 * name (for example `--background`). That keeps the variables readable in
 * devtools, usable from plain CSS as `var(--background)`, and stable for tests.
 *
 * This file must keep the `.stylex.ts` suffix and be imported through the
 * `@juno/tokens/tokens.stylex` subpath. StyleX refuses to resolve variables
 * through a barrel file.
 */
import * as stylex from '@stylexjs/stylex'

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)'

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/** Base palette. Warm paper in light; themes.stylex.ts has the warm near-black for dark. */
export const colors = stylex.defineVars({
  // Backgrounds and surfaces.
  '--background': 'hsla(48, 50%, 98%, 1)',
  '--background-subtle': 'hsla(48, 35%, 97%, 1)',
  '--surface-default': 'hsla(48, 30%, 98%, 1)',
  '--surface-hover': 'hsla(48, 30%, 94%, 1)',
  '--surface-active': 'hsla(48, 30%, 92%, 1)',
  '--peek-surface': 'hsla(48, 22%, 96%, 1)',
  // A surface that sits on top of --surface-hover and must read as raised in
  // both themes (the selected segment of a segmented control).
  '--surface-raised': 'hsla(48, 30%, 98%, 1)',

  // The Juno panel, a secondary surface like a macOS inspector: a step
  // below the page in light (between the sidebar and the chips), a step
  // above it in dark, so it separates without a border and the composer
  // field and Juno's bubbles read on it. No accent in it.
  '--panel-surface': 'hsla(48, 22%, 95.5%, 1)',
  // Juno's bubble on the panel: lighter than the panel in light, as the
  // field is; in dark the usual hover surface already is.
  '--panel-bubble': 'hsla(48, 40%, 99%, 1)',

  // Secondary fills: secondary buttons, selected rows, chips, tiles.
  '--secondary-default': 'hsla(48, 30%, 92%, 1)',
  '--secondary-hover': 'hsla(48, 30%, 90%, 1)',
  '--secondary-active': 'hsla(48, 30%, 88%, 1)',

  // Borders. Nearly invisible; inputs are the only real borders.
  '--border-subtle': 'hsla(48, 30%, 92%, 1)',
  '--border-default': 'hsla(48, 30%, 91%, 1)',
  '--border-strong': 'hsla(48, 30%, 88%, 1)',
  '--border-strongest': 'hsla(48, 30%, 82%, 1)',
  '--input-border': 'hsla(48, 14%, 82%, 1)',
  // The edge of an empty control that has no other shape (the welcome card's
  // unticked circle): 3:1 on a card, as a non-text control must be.
  '--border-control': 'hsla(48, 8%, 53%, 1)',

  // The tab strip, a step below the sidebar so the page-coloured active tab
  // stands out of it, as in Safari and Finder. Inactive tabs are the strip;
  // a hovered one takes --tab-hover, and a thin divider separates two
  // inactive neighbours.
  '--tab-strip': 'hsla(48, 26%, 94%, 1)',
  '--tab-hover': 'hsla(48, 24%, 90.5%, 1)',
  '--tab-divider': 'hsla(48, 14%, 80%, 1)',

  // Foreground. Warm neutrals, never pure black. Muted is darkened from the
  // handoff's 52% to 42% lightness so meta text reaches 4.5:1 on paper.
  '--foreground-default': 'hsla(48, 15%, 12%, 1)',
  '--foreground-subtle': 'hsla(48, 8%, 35%, 1)',
  '--foreground-muted': 'hsla(48, 5%, 42%, 1)',
  // An unread sidebar row's preview, the middle of its three text levels
  // (title, this, meta). A read row's preview is muted, like its meta. It
  // sits between default and muted in both themes; subtle is too close to
  // muted in light to read as its own level.
  '--foreground-secondary': 'hsla(48, 8%, 28%, 1)',
  // Muted text on a secondary fill (a selected row), where light muted
  // falls under 4.5:1. Dark muted passes there, so it stays muted and keeps
  // its step below the preview.
  '--foreground-muted-on-fill': 'hsla(48, 8%, 35%, 1)',

  // Ink accent. The default accent theme points --hl at this.
  '--accent-default': 'hsla(48, 30%, 8%, 1)',
  '--accent-hover': 'hsla(48, 30%, 10%, 1)',
  '--accent-active': 'hsla(48, 30%, 13%, 1)',
  '--accent-foreground': 'hsla(48, 20%, 95%, 1)',
  '--accent-foreground-subtle': 'hsla(48, 20%, 90%, 1)',
  '--accent-foreground-muted': 'hsla(48, 20%, 70%, 1)',

  // The dim behind the command palette.
  '--overlay': 'rgba(27, 28, 21, 0.16)',
  // Behind the media viewer: the page, nearly opaque, so only the picture reads.
  '--overlay-viewer': 'hsla(48, 50%, 98%, 0.94)',
  // Over a picture: the "+N" on the last tile of a message's images, and a
  // video's play badge. The same in both themes, since it sits on the picture.
  '--media-scrim': 'rgba(20, 19, 16, 0.65)',
  '--media-scrim-foreground': 'hsla(48, 20%, 98%, 1)',
  // Mixed with the text colour where they are used, so one value serves
  // every theme and every accent: a link's underline, a quote's fill.
  '--link-underline': 'color-mix(in oklch, currentColor 35%, transparent)',
  '--quote-fill': 'color-mix(in oklch, currentColor 6%, transparent)',

  // Status. Warning and info are only ever mixed into tints, never used as
  // text on their own (2.1:1 and 3.9:1).
  '--danger': '#C41E3A',
  // A control in a state the user must not miss, such as a muted microphone:
  // filled with --danger, its glyph in --background (5.6:1 light, 6.6:1 dark).
  // Hover mixes in the text colour, so it goes darker on paper and lighter
  // on ink. Press is the press scale alone, as on the other island controls.
  '--danger-fill-hover': 'color-mix(in oklch, var(--danger) 88%, var(--foreground-default))',
  '--success': '#00674F',
  // The active presence dot: a clear green, 3:1 against the menu it sits in.
  // --success is too deep for a 6px dot (it reads grey, 1.8:1 in dark).
  '--presence-active': '#1F9D66',
  // Live in a huddle: the speaking ring and the green headphones. A step deeper than the
  // presence dot so it holds 3:1 on the tiles' secondary fill too (3.36:1; 3.76:1 on a card).
  '--huddle-live': '#1C935F',
  // The sidebar's huddle bar, a frosted card in the accent. Each step keeps the
  // accent's hue and part of its chroma at a fixed lightness, so it follows
  // every accent and the text on it keeps one contrast: --foreground-subtle is
  // 4.78:1 or more on the fill and on hover for all eight accents. Written
  // with var() because a group cannot refer to another group defined after it.
  '--huddle-bar': 'oklch(from var(--hl) 0.93 calc(c * 0.28) h)',
  '--huddle-bar-edge': 'oklch(from var(--hl) 0.78 calc(c * 0.5) h)',
  '--huddle-bar-hover': 'oklch(from var(--hl) 0.9 calc(c * 0.28) h)',
  '--huddle-bar-pressed': 'oklch(from var(--hl) 0.865 calc(c * 0.28) h)',
  '--huddle-bar-pressed-hover': 'oklch(from var(--hl) 0.835 calc(c * 0.28) h)',
  // The frost: a sheen of white from the top, as on a macOS material.
  '--huddle-bar-sheen': 'linear-gradient(oklch(1 0 0 / 0.35), oklch(1 0 0 / 0) 70%)',
  '--warning': '#E0A500',
  '--info': '#008AB3',

  // The one warm colour. Illustration fill only: never text, never a
  // control, never a status. --warm-soft is 26% over the background in
  // light and 22% in dark. Written with var() because a group cannot refer
  // to its own keys.
  '--warm': '#E39A3B',
  '--warm-soft': 'color-mix(in oklch, #E39A3B 26%, var(--background))',
  // The check in the resolve toast: success mixed into the toast's own
  // background (the toast is ink on paper in light, paper on ink in dark).
  '--toast-success': 'color-mix(in oklch, #00674F 55%, var(--background))',
})

/**
 * The accent. Everything that uses the accent goes through this group, so
 * an accent is one theme that overrides these keys (themes.stylex.ts has
 * one per accent and theme). The defaults are Coral in light.
 *
 * - --hl: the fill (primary button, send, @you chip, Now chip)
 * - --hl-fg: text on the fill
 * - --hl-text: accent-coloured text and icons on paper or on a tint (the
 *   "new" label, the selected nav item, the subscribed bell)
 * - --hl-soft: the tint behind a message that mentions you, my reaction
 * - --hl-bubble: the owner's bubble in the Juno chat, a stronger tint than
 *   --hl-soft (16% light, 22% dark) with --foreground-default text
 * - --hl-nav: the selected nav item's fill, over the sidebar
 * - --hl-count, --hl-count-fg: the sidebar's counters, the accent at reduced
 *   brightness: a tint of it over the sidebar for the fill and a deeper
 *   (light) or dimmer (dark) accent for the text, held to 4.5:1 on the fill
 * - --hl-mention, --hl-mention-fg: the @you chip in a message, held to 6:1;
 *   in light the accents whose fill is lighter take the deeper --hl-text
 * - --hl-rule, --hl-ring: the new divider's rule and the mine-reaction ring
 * - --focus-ring: the accent text colour, so it meets 4.5:1 on the page
 * - --selection-background: text selection
 *
 * Counts outside the sidebar (the topic switcher) stay the soft grey tag.
 */
export const accent = stylex.defineVars({
  '--hl': '#CC4628',
  '--hl-fg': '#FFFFFF',
  '--hl-text': '#B4351F',
  '--hl-soft': `color-mix(in oklch, #CC4628 10%, ${colors['--background']})`,
  '--hl-bubble': `color-mix(in oklch, #CC4628 16%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #CC4628 9%, ${colors['--background-subtle']})`,
  '--hl-count': '#F7DED4',
  '--hl-count-fg': '#B3371B',
  '--hl-mention': '#B4351F',
  '--hl-mention-fg': '#FFFFFF',
  '--hl-rule': 'color-mix(in oklch, #CC4628 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #CC4628 45%, transparent)',
  '--focus-ring': '#B4351F',
  '--selection-background': `color-mix(in oklch, #CC4628 28%, ${colors['--background']})`,
})

/**
 * The eight accent fills and their text, for the accent picker's swatches.
 * The same values as the accent themes in themes.stylex.ts, repeated here
 * because a swatch shows every accent at once while only one theme is on.
 */
export const accentSwatches = stylex.defineVars({
  '--swatch-coral': '#CC4628',
  '--swatch-coral-fg': '#FFFFFF',
  '--swatch-ink': 'hsla(48, 30%, 8%, 1)',
  '--swatch-ink-fg': 'hsla(48, 20%, 95%, 1)',
  '--swatch-marigold': '#F2A900',
  '--swatch-marigold-fg': '#2B1E00',
  '--swatch-teal': '#0B7A75',
  '--swatch-teal-fg': '#FFFFFF',
  '--swatch-midnight': '#2E1F64',
  '--swatch-midnight-fg': '#FFFAEB',
  '--swatch-emerald': '#00674F',
  '--swatch-emerald-fg': '#FFFAEB',
  '--swatch-claret': '#7F1734',
  '--swatch-claret-fg': '#FFFAEB',
  '--swatch-cyan': '#008AB3',
  '--swatch-cyan-fg': 'hsla(48, 10%, 2%, 1)',
})

/**
 * An icon drawn in an accent's colour (a sidebar view's icon): each
 * accent's text colour, which holds 4.5:1 on the page and 3:1 or more on
 * the secondary fill of a selected pill, in both themes. The dark values
 * are in themes.stylex.ts. `--icon-tint-neutral` is the plain muted icon.
 */
export const iconTints = stylex.defineVars({
  '--icon-tint-neutral': colors['--foreground-muted'],
  '--icon-tint-coral': '#B4351F',
  '--icon-tint-ink': 'hsla(48, 30%, 8%, 1)',
  '--icon-tint-marigold': '#7F5200',
  '--icon-tint-teal': '#096762',
  '--icon-tint-midnight': '#2E1F64',
  '--icon-tint-emerald': '#00674F',
  '--icon-tint-claret': '#7F1734',
  '--icon-tint-cyan': '#006A8A',
})

/**
 * The Juno chat (SPEC section 13, inventory section 12). The owner bubble's
 * colour is still the owner's choice between options A to D
 * (docs/design/juno-chat/README.md): this is option B, the accent tint.
 * Switching options changes the two owner-bubble lines and nothing else:
 *
 *   A  accent['--hl']              / accent['--hl-fg']
 *   B  accent['--hl-bubble']       / colors['--foreground-default']
 *   C  colors['--secondary-default'] / colors['--foreground-default']
 *   D  colors['--accent-default']  / colors['--accent-foreground']
 *
 * The status bubble's three dots loop over --status-loop; under reduced
 * motion the pulse scale is 1 and the dots rest at --status-dot-opacity,
 * so the animation runs but nothing moves.
 */
export const chat = stylex.defineVars({
  '--owner-bubble-bg': accent['--hl-bubble'],
  '--owner-bubble-fg': colors['--foreground-default'],
  '--bubble-max-width': '76%',
  // In the Juno panel's narrow column.
  '--bubble-max-width-panel': '85%',
  '--bubble-tail': '4px',
  '--card-max-width': '560px',
  '--status-dot': '6px',
  '--status-min-width': '52px',
  '--status-loop': '1200ms',
  '--status-pulse-scale': {
    default: '1.35',
    [REDUCED_MOTION]: '1',
  },
  '--status-dot-opacity': {
    default: '1',
    [REDUCED_MOTION]: '0.6',
  },
  // How far a reaction badge sits out over its bubble's top corner.
  '--reaction-offset': '10px',
  // How far a bubble row may paint outside its box: the badge's offset and
  // its shadow. A plain length: Chromium ignores calc() in overflow-clip-margin.
  '--reaction-clip-margin': '16px',
  // The Juno panel's material (`--panel-surface`). Beside a topic it sits
  // on the page colour alone, so it is drawn opaque and costs nothing to
  // composite. Over the topic (a narrow window) it is the same fill, let
  // through and blurred like a macOS inspector; the header band fades the
  // list into the opaque fill.
  '--panel-fill': colors['--panel-surface'],
  '--panel-glass': `color-mix(in oklch, ${colors['--panel-surface']} 80%, transparent)`,
  // Juno's bubble and the status bubble; the panel sets `--panel-bubble`.
  '--juno-bubble-bg': colors['--surface-hover'],
  '--panel-backdrop': 'blur(24px) saturate(1.6)',
})

/**
 * Context tints for where a message lives, plus the status tints. All are
 * mixed from the base palette so they follow dark mode by themselves.
 */
export const tints = stylex.defineVars({
  '--tint-public-bg': colors['--secondary-default'],
  '--tint-public-fg': colors['--foreground-subtle'],
  '--tint-private-bg': `color-mix(in oklch, ${colors['--warning']} 15%, ${colors['--background']})`,
  '--tint-private-fg': `color-mix(in oklch, ${colors['--warning']} 42%, ${colors['--foreground-default']})`,
  '--tint-dm-bg': `color-mix(in oklch, ${colors['--info']} 12%, ${colors['--background']})`,
  '--tint-dm-fg': `color-mix(in oklch, ${colors['--info']} 55%, ${colors['--foreground-default']})`,
  '--tint-resolved-bg': `color-mix(in oklch, ${colors['--success']} 12%, ${colors['--background']})`,
  '--tint-resolved-fg': `color-mix(in oklch, ${colors['--success']} 70%, ${colors['--foreground-default']})`,
  '--tint-warning-bg': `color-mix(in oklch, ${colors['--warning']} 14%, ${colors['--surface-default']})`,
  '--tint-warning-fg': `color-mix(in oklch, ${colors['--warning']} 45%, ${colors['--foreground-default']})`,
  '--tint-mention-bg': accent['--hl-soft'],
  // A clickable context pill under the pointer: its tint with a little of the text colour mixed in.
  '--tint-public-hover': colors['--secondary-hover'],
  '--tint-private-hover': `color-mix(in oklch, ${colors['--warning']} 24%, ${colors['--background']})`,
  '--tint-dm-hover': `color-mix(in oklch, ${colors['--info']} 20%, ${colors['--background']})`,
})

/**
 * Person hues. A person gets one hue from a hash of their id; channels get
 * one from their id too, until the user picks another. The avatar mixes the
 * hue into the surface (24%) and the foreground (62%); the @mention chip
 * uses a lighter mix (16% / 40%) so its text passes 4.5:1 for every hue in
 * both themes (lowest measured 5.7:1, midnight in dark).
 */
export const hues = stylex.defineVars({
  '--hue-cyan': '#008AB3',
  '--hue-claret': '#7F1734',
  '--hue-midnight': '#2E1F64',
  '--hue-emerald-dark': '#00674F',
  '--hue-plum': '#E89EB8',
  '--hue-rose': '#A49496',
  '--hue-emerald': '#50C878',
  '--hue-jordy': '#92C2F9',

  '--avatar-bg-mix': '24%',
  '--avatar-fg-mix': '62%',
  '--person-chip-bg-mix': '16%',
  '--person-chip-fg-mix': '40%',
})

/**
 * Code colours, one per token kind of `@juno/highlight`. Calm: muted hues
 * at even lightness, so a block reads as text with a little colour, not a
 * poster. Every value is at least 4.5:1 on the code block's background
 * (`--background`): light 4.9 (comment) to 7.6, dark 6.4 to 9.2
 * (`docs/design/tokens.md` 1.10). Colour only: no weight or style, so a
 * coloured block has exactly the plain block's lines. Read by the
 * `::highlight(syntax-*)` rules in global.css.
 * @public
 */
export const syntax = stylex.defineVars({
  '--syntax-keyword': 'hsla(322, 38%, 36%, 1)',
  '--syntax-string': 'hsla(128, 34%, 28%, 1)',
  '--syntax-number': 'hsla(24, 70%, 34%, 1)',
  '--syntax-comment': 'hsla(48, 5%, 42%, 1)',
  '--syntax-function': 'hsla(214, 52%, 38%, 1)',
  '--syntax-type': 'hsla(180, 52%, 25%, 1)',
  '--syntax-constant': 'hsla(262, 38%, 44%, 1)',
  '--syntax-property': 'hsla(200, 58%, 30%, 1)',
  '--syntax-tag': 'hsla(4, 55%, 38%, 1)',
  '--syntax-punctuation': 'hsla(48, 8%, 35%, 1)',
  '--syntax-meta': 'hsla(36, 30%, 34%, 1)',
  '--syntax-inserted': 'hsla(140, 50%, 26%, 1)',
  '--syntax-deleted': 'hsla(358, 58%, 38%, 1)',
})

/**
 * Topic art (docs/design/topic-art/v2, colour from v3). Eight hues, each with
 * four roles the recipe may name and five Tide tones for the placeholder. The
 * renderer in `@juno/topic-art` writes these as `var(--art-<hue>-<role>)` and
 * `var(--tide-<hue>-<tone>)`, so one SVG string serves both themes; the dark
 * values are in themes.stylex.ts. Calm: one chroma for every hue, a small
 * lift over round 2 (ink 0.035, soft 0.05), and lightness stepped a little
 * by hue (amber and olive higher, periwinkle and plum lower; v3/directions.mjs,
 * `7c-calm-bright`). The colour spread comes from the hue, taken from the
 * topic id, not from chroma. The line stays under the preview text's
 * contrast. Written as oklch() so the browser maps
 * out-of-gamut chroma itself.
 */
export const art = stylex.defineVars({
  '--art-coral-ink': 'oklch(0.43 0.035 32)',
  '--art-coral-soft': 'oklch(0.875 0.05 32)',
  '--art-coral-accent': 'oklch(0.6 0.115 32)',
  '--art-coral-accent2': 'oklch(0.76 0.07 32)',
  '--art-amber-ink': 'oklch(0.443 0.035 72)',
  '--art-amber-soft': 'oklch(0.9 0.05 72)',
  '--art-amber-accent': 'oklch(0.625 0.115 72)',
  '--art-amber-accent2': 'oklch(0.785 0.07 72)',
  '--art-olive-ink': 'oklch(0.44 0.035 112)',
  '--art-olive-soft': 'oklch(0.895 0.05 112)',
  '--art-olive-accent': 'oklch(0.62 0.115 112)',
  '--art-olive-accent2': 'oklch(0.78 0.07 112)',
  '--art-sage-ink': 'oklch(0.435 0.035 150)',
  '--art-sage-soft': 'oklch(0.885 0.05 150)',
  '--art-sage-accent': 'oklch(0.61 0.115 150)',
  '--art-sage-accent2': 'oklch(0.77 0.07 150)',
  '--art-teal-ink': 'oklch(0.432 0.035 185)',
  '--art-teal-soft': 'oklch(0.88 0.05 185)',
  '--art-teal-accent': 'oklch(0.605 0.107 185)',
  '--art-teal-accent2': 'oklch(0.765 0.07 185)',
  '--art-sky-ink': 'oklch(0.425 0.035 235)',
  '--art-sky-soft': 'oklch(0.865 0.05 235)',
  '--art-sky-accent': 'oklch(0.59 0.115 235)',
  '--art-sky-accent2': 'oklch(0.75 0.07 235)',
  '--art-periwinkle-ink': 'oklch(0.42 0.035 275)',
  '--art-periwinkle-soft': 'oklch(0.855 0.05 275)',
  '--art-periwinkle-accent': 'oklch(0.58 0.115 275)',
  '--art-periwinkle-accent2': 'oklch(0.74 0.07 275)',
  '--art-plum-ink': 'oklch(0.422 0.035 320)',
  '--art-plum-soft': 'oklch(0.86 0.05 320)',
  '--art-plum-accent': 'oklch(0.585 0.115 320)',
  '--art-plum-accent2': 'oklch(0.745 0.07 320)',

  '--tide-coral-base': 'oklch(0.905 0.02 32)',
  '--tide-coral-soft': 'oklch(0.865 0.028 32)',
  '--tide-coral-mid': 'oklch(0.815 0.036 32)',
  '--tide-coral-deep': 'oklch(0.75 0.042 32)',
  '--tide-coral-pale': 'oklch(0.945 0.012 32)',
  '--tide-amber-base': 'oklch(0.905 0.02 72)',
  '--tide-amber-soft': 'oklch(0.865 0.028 72)',
  '--tide-amber-mid': 'oklch(0.815 0.036 72)',
  '--tide-amber-deep': 'oklch(0.75 0.042 72)',
  '--tide-amber-pale': 'oklch(0.945 0.012 72)',
  '--tide-olive-base': 'oklch(0.905 0.02 112)',
  '--tide-olive-soft': 'oklch(0.865 0.028 112)',
  '--tide-olive-mid': 'oklch(0.815 0.036 112)',
  '--tide-olive-deep': 'oklch(0.75 0.042 112)',
  '--tide-olive-pale': 'oklch(0.945 0.012 112)',
  '--tide-sage-base': 'oklch(0.905 0.02 150)',
  '--tide-sage-soft': 'oklch(0.865 0.028 150)',
  '--tide-sage-mid': 'oklch(0.815 0.036 150)',
  '--tide-sage-deep': 'oklch(0.75 0.042 150)',
  '--tide-sage-pale': 'oklch(0.945 0.012 150)',
  '--tide-teal-base': 'oklch(0.905 0.02 185)',
  '--tide-teal-soft': 'oklch(0.865 0.028 185)',
  '--tide-teal-mid': 'oklch(0.815 0.036 185)',
  '--tide-teal-deep': 'oklch(0.75 0.042 185)',
  '--tide-teal-pale': 'oklch(0.945 0.012 185)',
  '--tide-sky-base': 'oklch(0.905 0.02 235)',
  '--tide-sky-soft': 'oklch(0.865 0.028 235)',
  '--tide-sky-mid': 'oklch(0.815 0.036 235)',
  '--tide-sky-deep': 'oklch(0.75 0.042 235)',
  '--tide-sky-pale': 'oklch(0.945 0.012 235)',
  '--tide-periwinkle-base': 'oklch(0.905 0.02 275)',
  '--tide-periwinkle-soft': 'oklch(0.865 0.028 275)',
  '--tide-periwinkle-mid': 'oklch(0.815 0.036 275)',
  '--tide-periwinkle-deep': 'oklch(0.75 0.042 275)',
  '--tide-periwinkle-pale': 'oklch(0.945 0.012 275)',
  '--tide-plum-base': 'oklch(0.905 0.02 320)',
  '--tide-plum-soft': 'oklch(0.865 0.028 320)',
  '--tide-plum-mid': 'oklch(0.815 0.036 320)',
  '--tide-plum-deep': 'oklch(0.75 0.042 320)',
  '--tide-plum-pale': 'oklch(0.945 0.012 320)',
})

/* -------------------------------------------------------------------------- */
/* Shadows and rings                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Cards and floating surfaces get a wide, soft drop shadow and no ring,
 * never a coloured border. Inputs are the exception and keep --input-border.
 * The names --card-ring and --pop-shadow are kept so nothing has to move.
 */
export const shadows = stylex.defineVars({
  '--shadow-sm': '0 1px 2px 0 rgba(27, 28, 21, 0.04)',
  '--shadow-md': '0 2px 6px 0 rgba(27, 28, 21, 0.06)',
  '--shadow-card': '0 0 12px 0 rgba(27, 28, 21, 0.12)',
  '--shadow-lg': '0 8px 24px 0 rgba(27, 28, 21, 0.10)',
  '--card-ring': '0 1px 2px 0 oklch(0 0 0 / 0.03), 0 6px 20px -4px oklch(0 0 0 / 0.07)',
  // The huddle bar: a hairline highlight inside its top edge, as glass catches light, over the card's shadow.
  '--huddle-bar-shadow': 'inset 0 1px 0 0 oklch(1 0 0 / 0.7), 0 1px 2px 0 oklch(0 0 0 / 0.03), 0 6px 20px -4px oklch(0 0 0 / 0.07)',
  // An incoming huddle's card: a soft accent glow outside its accent edge, which pulses.
  '--huddle-incoming-glow': '0 0 0 3px oklch(from var(--hl) l c h / 0.42), 0 0 14px 2px oklch(from var(--hl) l c h / 0.32)',
  '--peek-shadow': '0 0 0 1px oklch(0 0 0 / 0.12), 0 2px 6px -1px oklch(0 0 0 / 0.08), 0 14px 36px -8px oklch(0 0 0 / 0.18)',
  '--pop-shadow': '0 2px 6px -1px oklch(0 0 0 / 0.05), 0 14px 36px -8px oklch(0 0 0 / 0.13)',
  // The Juno panel floating over the page: a hairline ring, a tight contact
  // shadow and two wide soft ones, so it lifts without a border.
  '--panel-shadow': '0 0 0 1px oklch(0 0 0 / 0.05), 0 1px 2px 0 oklch(0 0 0 / 0.04), 0 8px 24px -6px oklch(0 0 0 / 0.08), 0 24px 56px -12px oklch(0 0 0 / 0.12)',
  // The active tab lifted out of the strip: a soft shadow up and to the
  // sides only, so nothing falls on the page it joins.
  '--tab-shadow': '0 -1px 3px -1px oklch(0 0 0 / 0.08)',
  // A picture on the page (Home's picture, the picture page, the gallery): a thin edge drawn over it, so a
  // pale painting or a dark space image keeps its edge. Its shadow is --shadow-lg, --pop-shadow under the pointer.
  '--picture-edge': 'inset 0 0 0 1px oklch(0 0 0 / 0.06)',
})

/* -------------------------------------------------------------------------- */
/* Shape and space                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Radii. A label is a pill (tag, pill); a control or a container is a
 * rounded rectangle. Pills never nest inside pills. Nesting rule for
 * rectangles: outer radius = inner radius + padding. Compute new containers
 * from that rule rather than picking from the list.
 */
export const radii = stylex.defineVars({
  '--radius-inline': '2px',
  '--radius-xs': '4px',
  '--radius-sm': '5px',
  '--radius-md': '6px',
  '--radius-md-plus': '7px',
  '--radius-lg': '8px',
  // Nav and filter buttons, hover-toolbar buttons, 30px buttons, 32-36px
  // tiles, the To field.
  '--radius-xl': '12px',
  // Flat message hover row.
  '--radius-2xl': '14px',
  // Sidebar and list rows, the 44px channel tile, the hover toolbar.
  '--radius-3xl': '16px',
  // Cards and settings groups.
  '--radius-card': '20px',
  // The composer: a pill at its single-line height of 40px, and the same
  // 20px corner once it has grown, so a tall draft is not a capsule.
  '--radius-composer': '20px',
  '--radius-menu': '13px',
  '--radius-palette': '14px',
  '--radius-toast': '14px',
  '--radius-bubble': '16px',
  // The Juno panel: half the 36px header row, so the 28px controls 4px in
  // from its top corners nest in them (14 + 4).
  '--radius-panel': '18px',
  // Tags, counts, chips, reactions, the row Resolve and toast Undo buttons.
  '--radius-tag': '999px',
  // The context pill (header, To field, send card).
  '--radius-pill': '999px',
  '--radius-full': '999px',
})

/** Spacing. A 4px scale with the 2px and 6px steps the design actually uses. */
export const spacing = stylex.defineVars({
  '--space-pixel': '1px',
  '--space-0-5': '2px',
  '--space-1': '4px',
  '--space-1-5': '6px',
  '--space-2': '8px',
  '--space-2-5': '10px',
  '--space-3': '12px',
  '--space-3-5': '14px',
  '--space-4': '16px',
  '--space-5': '20px',
  '--space-6': '24px',
  '--space-7': '28px',
  '--space-8': '32px',
  '--space-9': '36px',
  '--space-10': '40px',
  '--space-12': '48px',
  '--space-14': '56px',
  '--space-16': '64px',
  '--space-18': '72px',
})

/* -------------------------------------------------------------------------- */
/* Type                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Families. Figtree (variable) for UI, Instrument Serif for page titles and
 * JetBrains Mono for hints and code, all bundled from @fontsource through
 * fonts.css.
 */
export const fonts = stylex.defineVars({
  '--font-sans': "'Figtree Variable', 'Figtree', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif': "'Instrument Serif', ui-serif, 'Iowan Old Style', Georgia, serif",
  '--font-mono': "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
})

export const weights = stylex.defineVars({
  '--weight-regular': '400',
  '--weight-medium': '500',
  '--weight-semibold': '600',
})

/** @public CSS variables read by global.css. */
export const tracking = stylex.defineVars({
  '--tracking-tight': '-0.01em',
  '--tracking-normal': '0',
  '--tracking-wide': '0.06em',
  '--tracking-none': '0',
})

/**
 * Type roles. Each role is the full setting for one kind of text: family,
 * size, weight, line height and letter spacing. The Text primitive maps a
 * role name to these; feature components should use Text or the same five
 * variables rather than inventing a size.
 *
 * The half-pixel sizes are deliberate; they are what keeps the hierarchy
 * quiet. Do not round them. Sizes are tuned for Figtree: its x-height is
 * about 8% smaller than Inter's and it runs about 6% narrower, so every sans
 * role at or below 15px is half a pixel larger than the prototype's Inter
 * value and lines come out the same width. Figtree's sidebearings are wide
 * enough that the 0.01em tracking Inter needed is gone.
 */
export const text = stylex.defineVars({
  '--topic-title-lines': '1',
  '--topic-title-white-space': 'nowrap',
  // Pinned / Recent / People / Channels headings, in sentence case (SPEC 17).
  '--text-section-label-family': fonts['--font-sans'],
  '--text-section-label-size': '11px',
  '--text-section-label-weight': '500',
  '--text-section-label-leading': 'normal',

  // Table column headers, in sentence case.
  '--text-table-header-family': fonts['--font-sans'],
  '--text-table-header-size': '11.5px',
  '--text-table-header-weight': '500',
  '--text-table-header-leading': 'normal',

  // The "3 new" divider label and the Juno chat's day label, in sentence case.
  '--text-divider-family': fonts['--font-sans'],
  '--text-divider-size': '11.5px',
  '--text-divider-weight': '600',
  '--text-divider-leading': 'normal',

  // Tags and count badges: Main, Reopened, unread count, @, hints.
  '--text-tag-family': fonts['--font-sans'],
  '--text-tag-size': '11.5px',
  '--text-tag-weight': '500',
  '--text-tag-leading': '18px',
  '--text-tag-tracking': '0',

  // Row Resolve button, card footnotes, "Use", Mark read.
  '--text-tag-small-family': fonts['--font-sans'],
  '--text-tag-small-size': '12px',
  '--text-tag-small-weight': '500',
  '--text-tag-small-leading': 'normal',
  '--text-tag-small-tracking': '0',

  // A two-line picker row (OptionRow 44): a 20px title line over a 16px meta
  // line, 4px above and below, so the row is 44px whatever the fonts' metrics.
  '--text-option-title-leading': '20px',
  '--text-option-meta-leading': '16px',

  // Times, timestamps, card headers, status chips, log reasons.
  '--text-meta-family': fonts['--font-sans'],
  '--text-meta-size': '12.5px',
  '--text-meta-weight': '400',
  '--text-meta-leading': 'normal',
  '--text-meta-tracking': '0',

  // Context pill and scope chip.
  '--text-pill-family': fonts['--font-sans'],
  '--text-pill-size': '13px',
  '--text-pill-weight': '600',
  '--text-pill-leading': 'normal',
  '--text-pill-tracking': '0',

  // 28px buttons: Fix and send, Stop ignoring, Not yet.
  '--text-button-small-family': fonts['--font-sans'],
  '--text-button-small-size': '13px',
  '--text-button-small-weight': '500',
  '--text-button-small-leading': 'normal',
  '--text-button-small-tracking': '0',

  // Nav, menu items, filters, buttons, selects, inputs, toast.
  '--text-ui-family': fonts['--font-sans'],
  '--text-ui-size': '13.5px',
  '--text-ui-weight': '400',
  '--text-ui-leading': '1.5',
  '--text-ui-tracking': '0',

  // Row line 2, clamped to one or two lines.
  '--text-preview-family': fonts['--font-sans'],
  '--text-preview-size': '13.5px',
  '--text-preview-weight': '400',
  '--text-preview-leading': '1.45',
  '--text-preview-tracking': '0',

  // Card bodies, reply options, picker rows.
  '--text-body-small-family': fonts['--font-sans'],
  '--text-body-small-size': '14px',
  '--text-body-small-weight': '400',
  '--text-body-small-leading': '1.55',
  '--text-body-small-tracking': '0',

  // Message body, composer, rule rows, palette labels, textareas.
  '--text-body-family': fonts['--font-sans'],
  '--text-body-size': '14.5px',
  '--text-body-weight': '400',
  '--text-body-leading': '1.6',
  '--text-body-tracking': '0',

  // Sidebar row title. Regular when read and 600 when unread, so unread stands out.
  '--text-row-title-family': fonts['--font-sans'],
  '--text-row-title-size': '14px',
  '--text-row-title-weight': '400',
  '--text-row-title-leading': '22px',
  '--text-row-title-tracking': '0',

  // Flat message sender name.
  '--text-message-name-family': fonts['--font-sans'],
  '--text-message-name-size': '14.5px',
  '--text-message-name-weight': '600',
  '--text-message-name-leading': 'normal',
  '--text-message-name-tracking': '0',

  // Settings section titles.
  '--text-heading-family': fonts['--font-sans'],
  '--text-heading-size': '15.5px',
  '--text-heading-weight': '600',
  '--text-heading-leading': '1.35',
  '--text-heading-tracking': '0',

  // Topic header title and its rename input.
  '--text-topic-title-family': fonts['--font-sans'],
  '--text-topic-title-size': '20px',
  '--text-topic-title-weight': '600',
  '--text-topic-title-leading': '1.3',
  '--text-topic-title-tracking': '-0.01em',

  // Page titles: the sections of Settings, All topics.
  '--text-page-title-family': fonts['--font-serif'],
  '--text-page-title-size': '34px',
  '--text-page-title-weight': '400',
  '--text-page-title-leading': '1.15',
  '--text-page-title-tracking': '0',

  // All topics, where the title shares a row with a search field.
  '--text-page-title-compact-family': fonts['--font-serif'],
  '--text-page-title-compact-size': '32px',
  '--text-page-title-compact-weight': '400',
  '--text-page-title-compact-leading': '1.1',
  '--text-page-title-compact-tracking': '0',

  // "What do you need?"
  '--text-display-family': fonts['--font-serif'],
  '--text-display-size': '38px',
  '--text-display-weight': '400',
  '--text-display-leading': '1.1',
  '--text-display-tracking': '0',

  // Home's greeting: "Morning, Tushar."
  '--text-greeting-family': fonts['--font-serif'],
  '--text-greeting-size': '36px',
  '--text-greeting-weight': '400',
  '--text-greeting-leading': '1.15',
  '--text-greeting-tracking': '0',

  // A sentence to read: the picture page's caption and the gallery's quotes.
  '--text-thought-family': fonts['--font-serif'],
  '--text-thought-size': '18px',
  '--text-thought-weight': '400',
  '--text-thought-leading': '1.45',
  '--text-thought-tracking': '0',

  // "Nothing open"
  '--text-empty-title-family': fonts['--font-serif'],
  '--text-empty-title-size': '30px',
  '--text-empty-title-weight': '400',
  '--text-empty-title-leading': '1.2',
  '--text-empty-title-tracking': '0',

  // esc, ⌘J, ⌘Z, ↵, confidence badge.
  '--text-kbd-family': fonts['--font-mono'],
  '--text-kbd-size': '11px',
  '--text-kbd-weight': '400',
  '--text-kbd-leading': 'normal',
  '--text-kbd-tracking': '0',

  // Prompt block.
  '--text-code-family': fonts['--font-mono'],
  '--text-code-size': '12.5px',
  '--text-code-weight': '400',
  '--text-code-leading': '1.6',
  '--text-code-tracking': '0',
})

/* -------------------------------------------------------------------------- */
/* Motion                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Three ideas: instant for what you do constantly, a quick ease-out for
 * presses and toggles, and a small spring for the few moments that deserve
 * it (a reaction landing, a toggle filling, a resolve check). Menus and
 * popovers enter in 80ms; other entrances are 240ms, exits 150ms, pops
 * 220ms; rows, tabs and typing never animate, except a tab being dragged,
 * whose neighbours slide aside over --duration-fast.
 *
 * Reduced motion collapses every duration, the scales and the distances
 * through the token itself, so components use these without a media query.
 * Opacity cross-fades remain as the visible cue.
 */
export const motion = stylex.defineVars({
  '--duration-fast': {
    default: '150ms',
    [REDUCED_MOTION]: '0.01ms',
  },
  '--duration-pop': {
    default: '220ms',
    [REDUCED_MOTION]: '0.01ms',
  },
  '--duration-appear': {
    default: '240ms',
    [REDUCED_MOTION]: '0.01ms',
  },
  '--duration-exit': {
    default: '150ms',
    [REDUCED_MOTION]: '0.01ms',
  },
  // Menus and popovers come in at once and may leave slower: a slow
  // entrance makes the interface feel slow (owner, 10-17).
  '--duration-menu-in': {
    default: '80ms',
    [REDUCED_MOTION]: '0.01ms',
  },
  // How long a send may take before its pending row dims (inventory 6.1).
  '--delay-pending': '800ms',
  // The gap between the illustration, title and action of an empty state.
  '--stagger': {
    default: '80ms',
    [REDUCED_MOTION]: '0ms',
  },
  '--ease-out': 'cubic-bezier(0.2, 0, 0, 1)',
  // One breath of the incoming huddle's pulse. Reduced motion stops the pulse instead.
  '--duration-pulse': '2400ms',
  // Overshoots by about 8%. The three pops only.
  '--ease-spring': 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  '--press-scale': {
    default: '0.96',
    [REDUCED_MOTION]: '1',
  },
  '--pop-scale': {
    default: '1.12',
    [REDUCED_MOTION]: '1',
  },
  // Entrances: the toast rises 8px, each part of an empty state rises 6px.
  '--rise-toast': {
    default: '8px',
    [REDUCED_MOTION]: '0px',
  },
  '--rise-stagger': {
    default: '6px',
    [REDUCED_MOTION]: '0px',
  },
  '--appear-scale': {
    default: '0.98',
    [REDUCED_MOTION]: '1',
  },
  '--toast-life-undo': '5000ms',
  '--toast-life-info': '4000ms',
})

/* -------------------------------------------------------------------------- */
/* Sizes                                                                      */
/* -------------------------------------------------------------------------- */

/** Layout. Fixed widths and heights of the shell. */
export const layout = stylex.defineVars({
  '--chat-empty-width': '520px',
  // A tooltip wraps past this; most are one short line.
  '--tooltip-max-width': '280px',
  // The default; the live width is this variable set on the shell.
  '--sidebar-width': '384px',
  '--sidebar-min-width': '312px',
  '--sidebar-max-width': '480px',
  '--sidebar-resize-hit': '6px',
  // The sidebar's inset on both sides: the title bar's end, the nav, the filter row and the rows. The list's
  // scrollbar gutter sits inside it on the right, so the rows' right edge matches their left.
  '--sidebar-inset': '10px',
  '--titlebar-height': '44px',
  // Kept free for the traffic lights at the start of the sidebar bar, or of
  // the tab strip while the sidebar is hidden.
  '--titlebar-lights-inset': '78px',
  '--tab-height': '35px',
  '--tab-width': '230px',
  '--tab-min-width': '120px',
  '--tab-pinned-width': '40px',
  // The page header (a topic, the Juno tab, the Juno panel): two islands
  // over the list, on a band of the page colour that is solid to the
  // islands' bottom edge and fades out by --header-band. The list under
  // it starts --header-inset down, so at scroll top its first row is clear
  // of the band.
  '--header-island-top': '8px',
  '--header-island-height': '36px',
  '--header-band-solid': '44px',
  '--header-band': '68px',
  '--header-inset': '56px',
  // The header's place pill at its widest, and the floor the title shortens to before the pill gives way.
  '--header-pill-max-width': '160px',
  '--header-title-min-width': '72px',
  '--reading-width': '800px',
  // The Juno panel beside a topic: a floating inspector, inset from the
  // tab strip, the window edge and the topic by the header islands' gap.
  // The default width gives a Juno bubble about 50 characters a line at
  // 14px. A drag on its edge sets a width from min to max. Beside the topic
  // it gives way down to its min so the topic keeps --juno-panel-topic-min;
  // under that it covers the topic (views/Workspace.tsx repeats min + topic
  // min + two insets in its container query, which cannot read a variable).
  '--juno-panel-width': '440px',
  '--juno-panel-min-width': '360px',
  '--juno-panel-max-width': '640px',
  '--juno-panel-topic-min': '480px',
  '--juno-panel-inset': '8px',
  '--juno-panel-resize-hit': '8px',
  '--composer-width': '752px',
  '--composer-max-height': '194px',
  '--composer-line-height': '22px',
  '--composer-padding-block': '9px',
  '--assistant-input-max-height': '160px',
  '--code-block-max-height': '150px',
  // The message hover toolbar's height. It straddles the row's top edge, so
  // a header keeps no room for it.
  '--toolbar-height': '36px',
  // How far a message row may paint outside its box: the toolbar's height
  // and its shadow, for the toolbar above (or flipped below) the row. A length, not
  // a calc(): Chromium ignores calc() in overflow-clip-margin.
  '--toolbar-clip-margin': '44px',
  // Image thumbnails in a message: never wider or taller than this, scaled
  // by their own aspect ratio. File cards share the width.
  '--thumb-max-width': '360px',
  '--thumb-max-height': '240px',
  // A tile of a message's image grid: two rows and the gap fill --thumb-max-height.
  '--thumb-tile-height': '117px',
  // The media viewer's header bar, the same for every item.
  '--viewer-bar-width': '560px',
  // A picture in the media viewer's filmstrip, square.
  '--filmstrip-thumb': '56px',
  '--search-field-width': '260px',
  // The All topics table (inventory 10): topic, where, status, messages,
  // updated. Where gives way first: it shrinks to its minimum, then the
  // column hides, then Msgs hides (views/AllTopics.tsx repeats the widths
  // in its container queries). On a page under 520px Status hides too and
  // the title takes the rest, so the table never scrolls sideways.
  '--all-topics-columns': 'minmax(200px, 1fr) minmax(72px, 150px) 104px 44px 84px',
  '--all-topics-columns-narrow': 'minmax(200px, 1fr) 104px 44px 84px',
  '--all-topics-columns-narrowest': 'minmax(200px, 1fr) 104px 84px',
  '--all-topics-columns-compact': 'minmax(0, 1fr) 84px',
  '--keyword-field-width': '160px',
  // Home's column: the item rows and the Ask Juno field.
  '--home-width': '480px',
  '--page-width-narrow': '680px',
  '--page-width': '720px',
  '--page-width-settings': '760px',
  // The label column of Settings' rows (Theme, Accent, Density, Hold to peek), so the controls share one edge.
  // Settings' list of sections, beside the section's page. Fits "Backup & This Mac" with the sidebar's insets.
  '--settings-nav-width': '200px',
  // A wrapping ListRow keeps its text at least this wide; under it the controls go to a line of their own.
  '--list-row-wrap-min': '200px',
  '--palette-width': '560px',
  '--palette-top': '96px',
  '--palette-list-max-height': '400px',
  // A tool row of the Configure sheet: two lines (20 + 16) and 10px above and below, on the 4px grid.
  '--tool-row-height': '56px',
  '--menu-width': '236px',
  // Who reacted (the reaction chip's card): narrow enough for one short name, no wider than a menu.
  '--reactors-min-width': '160px',
  '--menu-width-account': '248px',
  '--menu-width-browse': '300px',
  '--menu-width-mention': '280px',
  // The list a first @ or # opens on Home: wide enough for a name and its kind.
  '--send-to-width': '320px',
  // Home's destination list and All topics' place list.
  '--menu-width-picker': '340px',
  '--destination-list-max-height': '360px',
  // On a narrow Home the topic chip shortens to this before the destination chip shortens: its mark, a few letters and the caret.
  '--topic-chip-min-width': '96px',
  // A sidebar view's name pill (inventory 2.3): longer names end with an ellipsis.
  '--filter-pill-max-width': '120px',
  // The view sheet's conversation list (inventory 2.3), which scrolls past this.
  '--view-sheet-list-max-height': '200px',
  // The peek popover: about 75 characters of message text in compact rows;
  // never wider than the room left in the window.
  '--peek-width': '640px',
  // The peek's header: one 20px line with 12px above and below.
  '--peek-header-height': '44px',
  // Never taller than the window below a title-bar anchor, so a menu fits
  // at the minimum size and under zoom; the content scrolls inside.
  '--popover-max-height': 'min(400px, calc(100vh - var(--titlebar-height) - var(--space-5)))',
  '--picker-max-height': '300px',
  // The full emoji picker at a fixed size, so opening it never moves
  // anything: nine 32px cells, 12px and 2px padding, the 10px scrollbar
  // gutter and the 1px border on each side.
  '--emoji-picker-width': '314px',
  '--emoji-picker-height': '360px',
  // A huddle tab's participant tile: a 44px photo and a name of about 18 characters. Rows of them wrap and centre.
  '--huddle-tile-width': '160px',
  // The screen share sheet: three thumbnails a row at 16:10, and its list's one height in every state (it scrolls past it).
  '--source-picker-width': '600px',
  '--source-picker-list-height': '420px',
  '--toast-max-width': '352px',
  '--toast-inset': '16px',
  '--scrollbar-size': '10px',
})

/**
 * Control heights, tiles, avatars and icons, named by their pixel size so a
 * spec measurement maps straight to a token.
 */
export const sizes = stylex.defineVars({
  '--inline-em': '1em',
  '--link-underline-offset': '0.12em',
  '--control-18': '18px',
  '--control-20': '20px',
  '--control-22': '22px',
  '--control-24': '24px',
  '--topic-time-width': '48px',
  '--control-26': '26px',
  '--control-28': '28px',
  '--control-30': '30px',
  '--control-32': '32px',
  '--control-34': '34px',
  '--control-36': '36px',
  '--control-40': '40px',
  '--control-44': '44px',

  '--row-44': '44px',
  '--row-48': '48px',
  '--row-52': '52px',
  // A sidebar row's content box: three lines (title, one-line preview, meta),
  // rounded up to a whole pixel. The row is this plus its block padding (88px
  // in Comfortable) whatever it shows, so the off-screen estimate
  // (contain-intrinsic-size) is exact and rows never land on a fraction.
  '--row-topic-estimate': '66px',
  // A Main row (a channel's, a DM's or a group DM's) has no meta line: the
  // title and the preview only (64px in Comfortable).
  '--row-topic-two-line-estimate': '42px',
  // The same estimate for off-screen message rows: one line of body under a
  // name, without the row's block padding (performance.md 3.3).
  '--row-message-estimate': '56px',
  // A one-line chat bubble off screen: 8px padding above and below a 22px line.
  '--row-bubble-estimate': '38px',

  // Home's picture (SPEC 12, "A picture"): the box the picture is fitted into. Its height is the page's
  // height less the room the rest of Home takes (the column's padding, the two-line caption and the
  // composer), between the min and the full height, so the column fits.
  '--home-picture-width': '320px',
  '--home-picture-height': '216px',
  '--home-picture-height-min': '144px',
  '--home-picture-room': '264px',
  // The gallery's rows of pictures, each at its own shape, and the picture page's label column.
  '--gallery-row': '150px',
  '--picture-label-width': '380px',

  '--tile-44': '44px',
  '--tile-36': '36px',
  '--avatar-32': '32px',
  '--avatar-28': '28px',
  '--avatar-24': '24px',
  '--avatar-20': '20px',
  '--avatar-18': '18px',
  '--avatar-16': '16px',
  // A group DM's member in a 20px destination mark (GroupAvatar).
  '--avatar-13': '13px',
  // A group DM's member in a 16px tab icon (GroupAvatar).
  '--avatar-11': '11px',
  '--avatar-stack-overlap': '-4px',
  '--avatar-ring': '1.5px',
  // The green ring around a huddle participant who is speaking (avatar or tile).
  '--speaking-ring': '2px',

  '--initials-44': '14px',
  '--initials-36': '14px',
  '--initials-32': '12px',
  '--initials-28': '11px',
  '--initials-24': '9.5px',
  '--initials-20': '9px',
  '--initials-18': '8.5px',
  '--initials-16': '7px',

  // Phosphor glyphs are filled paths; weight comes from the variant, so
  // there is no stroke token.
  '--icon-12': '12px',
  '--icon-13': '13px',
  '--icon-14': '14px',
  '--icon-15': '15px',
  '--icon-16': '16px',
  '--icon-18': '18px',
  '--icon-20': '20px',

  // Spot illustrations: 96 wide in lists, 120 in the workspace. The Juno
  // figure alone is 40.
  '--illustration-list': '96px',
  '--illustration-workspace': '120px',
  '--illustration-figure': '40px',

  '--checkbox': '15px',
  '--slider-track': '4px',
  '--slider-thumb': '14px',
  '--slider-width': '200px',
  '--unread-dot': '5px',
  '--tab-unread-dot': '6px',
  // The divider between two inactive tabs, centred on their height.
  '--tab-divider-height': '16px',
  '--focus-ring-width': '2px',
  '--focus-ring-offset': '2px',
  // How far an outset ring reaches past its element: the width plus the
  // offset. A box that clips (a scroller, paint containment) keeps this much
  // room around its controls (ringRoom in @juno/ui).
  '--focus-ring-room': 'calc(var(--focus-ring-width) + var(--focus-ring-offset))',
  // Privacy mode: how far message text is blurred (tokens/global.css, [data-sensitive]).
  '--privacy-blur': '6px',
})

/* -------------------------------------------------------------------------- */
/* Layers and opacity                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Density (Settings › Appearance, inventory 3.3 and 6.1). These are the
 * Comfortable values; `compact` in themes.stylex.ts overrides them on
 * <html>. Only the sidebar row and the message row read them.
 */
export const density = stylex.defineVars({
  '--density-row-padding-block': '11px',
  // Line three's gap above it.
  '--density-row-line-gap': '2px',
  // The 44px tile drawn at 36px in Compact.
  '--density-row-tile-zoom': '1',
  // The row's content-box estimate for off-screen rows.
  '--density-row-estimate': sizes['--row-topic-estimate'],
  // The same for a row with no meta line (any Main).
  '--density-row-two-line-estimate': sizes['--row-topic-two-line-estimate'],
  '--density-message-padding-block': '4px',
  // Above the first message of a sender group.
  '--density-message-group-gap': '12px',
})

export const z = stylex.defineVars({
  // A message row at rest. Not auto: a row raised to --z-toolbar on hover then
  // only changes its order, and Chromium lays out a row again when z-index
  // goes from auto to a number (performance.md 8.14).
  '--z-row': '0',
  '--z-toolbar': '2',
  '--z-header': '3',
  // The Juno panel when it covers the topic: over the topic's header and toolbar.
  '--z-panel': '4',
  '--z-mention': '5',
  '--z-picker': '10',
  '--z-menu': '20',
  '--z-palette': '30',
  // The media viewer, over the whole window. Never open with the palette.
  '--z-viewer': '30',
  '--z-selection': '35',
  '--z-context': '40',
  '--z-toast': '45',
  // A tooltip names what is under the pointer, so it sits over everything.
  '--z-tooltip': '50',
})

export const opacity = stylex.defineVars({
  '--opacity-disabled': '0.4',
  '--opacity-dim': '0.6',
  '--opacity-tab-icon': '0.75',
  '--opacity-kbd': '0.75',
})
