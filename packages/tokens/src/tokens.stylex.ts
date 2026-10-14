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
  // A surface that sits on top of --surface-hover and must read as raised in
  // both themes (the selected segment of a segmented control).
  '--surface-raised': 'hsla(48, 30%, 98%, 1)',

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

  // Foreground. Warm neutrals, never pure black. Muted is darkened from the
  // handoff's 52% to 42% lightness so meta text reaches 4.5:1 on paper.
  '--foreground-default': 'hsla(48, 15%, 12%, 1)',
  '--foreground-subtle': 'hsla(48, 8%, 35%, 1)',
  '--foreground-muted': 'hsla(48, 5%, 42%, 1)',

  // Ink accent. The default accent theme points --hl at this.
  '--accent-default': 'hsla(48, 30%, 8%, 1)',
  '--accent-hover': 'hsla(48, 30%, 10%, 1)',
  '--accent-active': 'hsla(48, 30%, 13%, 1)',
  '--accent-foreground': 'hsla(48, 20%, 95%, 1)',
  '--accent-foreground-subtle': 'hsla(48, 20%, 90%, 1)',
  '--accent-foreground-muted': 'hsla(48, 20%, 70%, 1)',

  // The dim behind the command palette.
  '--overlay': 'rgba(27, 28, 21, 0.16)',

  // Status. Warning and info are only ever mixed into tints, never used as
  // text on their own (2.1:1 and 3.9:1).
  '--danger': '#C41E3A',
  '--success': '#00674F',
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
 * - --hl-rule, --hl-ring: the new divider's rule and the mine-reaction ring
 * - --focus-ring: the accent text colour, so it meets 4.5:1 on the page
 * - --selection-background: text selection
 *
 * Unread counts are never the accent; they stay the soft grey tag.
 */
export const accent = stylex.defineVars({
  '--hl': '#CC4628',
  '--hl-fg': '#FFFFFF',
  '--hl-text': '#B4351F',
  '--hl-soft': `color-mix(in oklch, #CC4628 10%, ${colors['--background']})`,
  '--hl-bubble': `color-mix(in oklch, #CC4628 16%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #CC4628 9%, ${colors['--background-subtle']})`,
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
  // "Queued" shows under a steer only after this long, so a steer read
  // within one tool round never flickers. Not collapsed by reduced motion:
  // it is a delay, not a movement.
  '--delay-queued': '500ms',
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
 * Topic art (docs/design/topic-art/v2). Eight hues, each with four roles the
 * recipe may name and five Tide tones for the placeholder. The renderer in
 * `@juno/topic-art` writes these as `var(--art-<hue>-<role>)` and
 * `var(--tide-<hue>-<tone>)`, so one SVG string serves both themes; the dark
 * values are in themes.stylex.ts. Lightness and chroma are the study's RAMP
 * and TIDE_RAMP; the hue angle is the only value a hue shares across roles.
 * Written as oklch() so the browser maps out-of-gamut chroma itself.
 */
export const art = stylex.defineVars({
  '--art-coral-ink': 'oklch(0.43 0.022 32)',
  '--art-coral-soft': 'oklch(0.885 0.038 32)',
  '--art-coral-accent': 'oklch(0.6 0.1 32)',
  '--art-coral-accent2': 'oklch(0.76 0.06 32)',
  '--art-amber-ink': 'oklch(0.43 0.022 72)',
  '--art-amber-soft': 'oklch(0.885 0.038 72)',
  '--art-amber-accent': 'oklch(0.6 0.1 72)',
  '--art-amber-accent2': 'oklch(0.76 0.06 72)',
  '--art-olive-ink': 'oklch(0.43 0.022 112)',
  '--art-olive-soft': 'oklch(0.885 0.038 112)',
  '--art-olive-accent': 'oklch(0.6 0.1 112)',
  '--art-olive-accent2': 'oklch(0.76 0.06 112)',
  '--art-sage-ink': 'oklch(0.43 0.022 150)',
  '--art-sage-soft': 'oklch(0.885 0.038 150)',
  '--art-sage-accent': 'oklch(0.6 0.1 150)',
  '--art-sage-accent2': 'oklch(0.76 0.06 150)',
  '--art-teal-ink': 'oklch(0.43 0.022 185)',
  '--art-teal-soft': 'oklch(0.885 0.038 185)',
  '--art-teal-accent': 'oklch(0.6 0.1 185)',
  '--art-teal-accent2': 'oklch(0.76 0.06 185)',
  '--art-sky-ink': 'oklch(0.43 0.022 235)',
  '--art-sky-soft': 'oklch(0.885 0.038 235)',
  '--art-sky-accent': 'oklch(0.6 0.1 235)',
  '--art-sky-accent2': 'oklch(0.76 0.06 235)',
  '--art-periwinkle-ink': 'oklch(0.43 0.022 275)',
  '--art-periwinkle-soft': 'oklch(0.885 0.038 275)',
  '--art-periwinkle-accent': 'oklch(0.6 0.1 275)',
  '--art-periwinkle-accent2': 'oklch(0.76 0.06 275)',
  '--art-plum-ink': 'oklch(0.43 0.022 320)',
  '--art-plum-soft': 'oklch(0.885 0.038 320)',
  '--art-plum-accent': 'oklch(0.6 0.1 320)',
  '--art-plum-accent2': 'oklch(0.76 0.06 320)',

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
  '--pop-shadow': '0 2px 6px -1px oklch(0 0 0 / 0.05), 0 14px 36px -8px oklch(0 0 0 / 0.13)',
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
  // Tags, counts, chips, reactions, the row Resolve and toast Undo buttons.
  '--radius-tag': '999px',
  // The context pill (header, To field, send card).
  '--radius-pill': '999px',
  '--radius-full': '999px',
})

/** Spacing. A 4px scale with the 2px and 6px steps the design actually uses. */
export const spacing = stylex.defineVars({
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
  // Pinned / Recent / People / Channels headings. Rendered uppercase.
  '--text-section-label-family': fonts['--font-sans'],
  '--text-section-label-size': '11px',
  '--text-section-label-weight': '500',
  '--text-section-label-leading': 'normal',
  '--text-section-label-tracking': '0.06em',

  // Table column headers. Rendered uppercase.
  '--text-table-header-family': fonts['--font-sans'],
  '--text-table-header-size': '11.5px',
  '--text-table-header-weight': '500',
  '--text-table-header-leading': 'normal',
  '--text-table-header-tracking': '0.06em',

  // "3 NEW" divider label. Rendered uppercase.
  '--text-divider-family': fonts['--font-sans'],
  '--text-divider-size': '11.5px',
  '--text-divider-weight': '600',
  '--text-divider-leading': 'normal',
  '--text-divider-tracking': '0.06em',

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

  // 28px buttons: Group into topic, Fix and send, Stop ignoring, Not yet.
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

  // Catch-up text, card bodies, reply options, picker rows.
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

  // Sidebar row title. 600 when unread.
  '--text-row-title-family': fonts['--font-sans'],
  '--text-row-title-size': '15px',
  '--text-row-title-weight': '500',
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

  // Page titles: Notifications, Preferences.
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
 * it (a reaction landing, a toggle filling, a resolve check). Entrances are
 * 240ms, exits 150ms, pops 220ms; rows, tabs and typing never animate.
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
  // The gap between the illustration, title and action of an empty state.
  '--stagger': {
    default: '80ms',
    [REDUCED_MOTION]: '0ms',
  },
  '--ease-out': 'cubic-bezier(0.2, 0, 0, 1)',
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
  '--sidebar-width': '384px',
  '--titlebar-height': '44px',
  '--tab-height': '35px',
  '--tab-width': '230px',
  '--tab-min-width': '120px',
  '--topic-header-height': '100px',
  '--reading-width': '800px',
  '--composer-width': '752px',
  '--composer-max-height': '194px',
  '--composer-line-height': '22px',
  '--composer-padding-block': '9px',
  '--assistant-input-max-height': '160px',
  '--code-block-max-height': '150px',
  // The message hover toolbar: its height, and the width a message header
  // keeps free at its end so the name and time never run under it. The Main
  // toolbar is 193px (six 28px buttons, 2px gaps, a 5px rule, 4px padding)
  // plus a 20px gap.
  '--toolbar-height': '36px',
  '--toolbar-reserve': '213px',
  // Image thumbnails in a message: never wider or taller than this, scaled
  // by their own aspect ratio. File cards share the width.
  '--thumb-max-width': '360px',
  '--thumb-max-height': '280px',
  '--search-field-width': '260px',
  '--keyword-field-width': '160px',
  '--page-width-narrow': '680px',
  '--page-width': '720px',
  '--page-width-settings': '760px',
  '--page-width-wide': '880px',
  '--palette-width': '560px',
  '--palette-top': '96px',
  '--menu-width': '236px',
  '--menu-width-account': '248px',
  '--menu-width-browse': '300px',
  '--menu-width-mention': '280px',
  // Never taller than the window below a title-bar anchor, so a menu fits
  // at the minimum size and under zoom; the content scrolls inside.
  '--popover-max-height': 'min(400px, calc(100vh - var(--titlebar-height) - var(--space-5)))',
  '--picker-max-height': '300px',
  '--toast-max-width': '352px',
  '--toast-inset': '16px',
  '--scrollbar-size': '10px',
})

/**
 * Control heights, tiles, avatars and icons, named by their pixel size so a
 * spec measurement maps straight to a token.
 */
export const sizes = stylex.defineVars({
  '--control-18': '18px',
  '--control-20': '20px',
  '--control-22': '22px',
  '--control-24': '24px',
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
  // The contain-intrinsic-size estimate for off-screen sidebar rows. It sizes
  // the content box, so it is the row's measured height without its 11px
  // block padding: 85px for a two-line preview (the row is 107px).
  '--row-topic-estimate': '85px',
  // The same estimate for off-screen message rows: one line of body under a
  // name, without the row's block padding (performance.md 3.3).
  '--row-message-estimate': '56px',

  '--tile-44': '44px',
  '--tile-36': '36px',
  '--avatar-32': '32px',
  '--avatar-28': '28px',
  '--avatar-24': '24px',
  '--avatar-20': '20px',
  '--avatar-18': '18px',
  '--avatar-stack-overlap': '-4px',
  '--avatar-ring': '1.5px',

  '--initials-44': '14px',
  '--initials-36': '14px',
  '--initials-32': '12px',
  '--initials-28': '11px',
  '--initials-24': '9.5px',
  '--initials-20': '9px',
  '--initials-18': '8.5px',

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
  '--focus-ring-width': '2px',
  '--focus-ring-offset': '2px',
})

/* -------------------------------------------------------------------------- */
/* Layers and opacity                                                         */
/* -------------------------------------------------------------------------- */

export const z = stylex.defineVars({
  '--z-toolbar': '2',
  '--z-mention': '5',
  '--z-picker': '10',
  '--z-menu': '20',
  '--z-palette': '30',
  '--z-selection': '35',
  '--z-context': '40',
  '--z-toast': '45',
})

export const opacity = stylex.defineVars({
  '--opacity-disabled': '0.4',
  '--opacity-dim': '0.6',
  '--opacity-tab-icon': '0.75',
  '--opacity-kbd': '0.75',
})
