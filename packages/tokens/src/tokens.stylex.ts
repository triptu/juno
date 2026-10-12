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

/** Base palette. Warm paper in light, cool near-black in dark. */
export const colors = stylex.defineVars({
  // Backgrounds and surfaces.
  '--background': 'hsla(48, 50%, 98%, 1)',
  '--background-subtle': 'hsla(48, 35%, 97%, 1)',
  '--surface-default': 'hsla(48, 30%, 98%, 1)',
  '--surface-hover': 'hsla(48, 30%, 94%, 1)',
  '--surface-active': 'hsla(48, 30%, 92%, 1)',

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

  // Text selection only. The focus ring has its own, more visible colour.
  '--selection-background': 'hsla(200, 50%, 80%, 1)',
  '--focus-ring': '#008AB3',

  // The dim behind the command palette.
  '--overlay': 'rgba(27, 28, 21, 0.16)',

  // Status. Warning and info are only ever mixed into tints, never used as
  // text on their own (2.1:1 and 3.9:1).
  '--danger': '#C41E3A',
  '--success': '#00674F',
  '--warning': '#E0A500',
  '--info': '#008AB3',
})

/**
 * The accent. Everything that uses the accent goes through these three, so
 * an accent theme only has to override --hl and --hl-fg.
 */
export const accent = stylex.defineVars({
  '--hl': colors['--accent-default'],
  '--hl-fg': colors['--accent-foreground'],
  '--hl-soft': `color-mix(in oklch, ${colors['--accent-default']} 9%, ${colors['--background']})`,
  '--hl-rule': `color-mix(in oklch, ${colors['--accent-default']} 30%, transparent)`,
  '--hl-ring': `color-mix(in oklch, ${colors['--accent-default']} 45%, transparent)`,
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
 * Person hues for avatars. A person gets one hue from a hash of their id;
 * the avatar mixes it into the surface (background) and the foreground.
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
})

/* -------------------------------------------------------------------------- */
/* Shadows and rings                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Floating surfaces get a ring (a 1px shadow) plus a soft drop, never a
 * coloured border. Inputs are the exception and keep --input-border.
 */
export const shadows = stylex.defineVars({
  '--shadow-sm': '0 1px 2px 0 rgba(27, 28, 21, 0.04)',
  '--shadow-md': '0 2px 6px 0 rgba(27, 28, 21, 0.06)',
  '--shadow-card': '0 0 12px 0 rgba(27, 28, 21, 0.12)',
  '--shadow-lg': '0 8px 24px 0 rgba(27, 28, 21, 0.10)',
  '--card-ring': '0 0 0 1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.06), 0 2px 4px 0 oklch(0 0 0 / 0.04)',
  '--pop-shadow': '0 0 0 1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.08), 0 10px 28px -6px oklch(0 0 0 / 0.14)',
})

/* -------------------------------------------------------------------------- */
/* Shape and space                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Radii. Nesting rule: outer radius = inner radius + padding. Compute new
 * containers from that rule rather than picking from the list.
 */
export const radii = stylex.defineVars({
  '--radius-xs': '4px',
  '--radius-sm': '5px',
  '--radius-md': '6px',
  '--radius-md-plus': '7px',
  '--radius-lg': '8px',
  '--radius-lg-plus': '9px',
  '--radius-xl': '10px',
  '--radius-2xl': '12px',
  '--radius-menu': '13px',
  '--radius-palette': '14px',
  '--radius-bubble': '16px',
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
 * Families. Inter (variable) for UI and Instrument Serif for page titles,
 * both bundled from @fontsource through fonts.css. Mono is the system's.
 */
export const fonts = stylex.defineVars({
  '--font-sans': "'Inter Variable', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif': "'Instrument Serif', ui-serif, 'Iowan Old Style', Georgia, serif",
  '--font-mono': "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
})

export const weights = stylex.defineVars({
  '--weight-regular': '400',
  '--weight-medium': '500',
  '--weight-semibold': '600',
})

export const tracking = stylex.defineVars({
  '--tracking-tight': '-0.01em',
  '--tracking-normal': '0.01em',
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
 * quiet. Do not round them.
 */
export const text = stylex.defineVars({
  // Pinned / Recent / People / Channels headings. Rendered uppercase.
  '--text-section-label-family': fonts['--font-sans'],
  '--text-section-label-size': '10.5px',
  '--text-section-label-weight': '500',
  '--text-section-label-leading': 'normal',
  '--text-section-label-tracking': '0.06em',

  // Table column headers. Rendered uppercase.
  '--text-table-header-family': fonts['--font-sans'],
  '--text-table-header-size': '11px',
  '--text-table-header-weight': '500',
  '--text-table-header-leading': 'normal',
  '--text-table-header-tracking': '0.06em',

  // "3 NEW" divider label. Rendered uppercase.
  '--text-divider-family': fonts['--font-sans'],
  '--text-divider-size': '11px',
  '--text-divider-weight': '600',
  '--text-divider-leading': 'normal',
  '--text-divider-tracking': '0.06em',

  // Tags and count badges: Main, Reopened, unread count, @, hints.
  '--text-tag-family': fonts['--font-sans'],
  '--text-tag-size': '11px',
  '--text-tag-weight': '500',
  '--text-tag-leading': '18px',
  '--text-tag-tracking': '0',

  // Row Resolve button, card footnotes, "Use", Mark read.
  '--text-tag-small-family': fonts['--font-sans'],
  '--text-tag-small-size': '11.5px',
  '--text-tag-small-weight': '500',
  '--text-tag-small-leading': 'normal',
  '--text-tag-small-tracking': '0.01em',

  // Times, timestamps, card headers, status chips, log reasons.
  '--text-meta-family': fonts['--font-sans'],
  '--text-meta-size': '12px',
  '--text-meta-weight': '400',
  '--text-meta-leading': 'normal',
  '--text-meta-tracking': '0.01em',

  // Context pill and scope chip.
  '--text-pill-family': fonts['--font-sans'],
  '--text-pill-size': '12.5px',
  '--text-pill-weight': '600',
  '--text-pill-leading': 'normal',
  '--text-pill-tracking': '0.01em',

  // 28px buttons: Group into topic, Fix and send, Stop ignoring, Not yet.
  '--text-button-small-family': fonts['--font-sans'],
  '--text-button-small-size': '12.5px',
  '--text-button-small-weight': '500',
  '--text-button-small-leading': 'normal',
  '--text-button-small-tracking': '0.01em',

  // Nav, menu items, filters, buttons, selects, inputs, toast.
  '--text-ui-family': fonts['--font-sans'],
  '--text-ui-size': '13px',
  '--text-ui-weight': '400',
  '--text-ui-leading': '1.5',
  '--text-ui-tracking': '0.01em',

  // Row line 2, clamped to one or two lines.
  '--text-preview-family': fonts['--font-sans'],
  '--text-preview-size': '13px',
  '--text-preview-weight': '400',
  '--text-preview-leading': '1.45',
  '--text-preview-tracking': '0.01em',

  // Catch-up text, card bodies, reply options, picker rows.
  '--text-body-small-family': fonts['--font-sans'],
  '--text-body-small-size': '13.5px',
  '--text-body-small-weight': '400',
  '--text-body-small-leading': '1.55',
  '--text-body-small-tracking': '0.01em',

  // Message body, composer, rule rows, palette labels, textareas.
  '--text-body-family': fonts['--font-sans'],
  '--text-body-size': '14px',
  '--text-body-weight': '400',
  '--text-body-leading': '1.6',
  '--text-body-tracking': '0.01em',

  // Sidebar row title. 600 when unread.
  '--text-row-title-family': fonts['--font-sans'],
  '--text-row-title-size': '14.5px',
  '--text-row-title-weight': '500',
  '--text-row-title-leading': '22px',
  '--text-row-title-tracking': '0',

  // Flat message sender name.
  '--text-message-name-family': fonts['--font-sans'],
  '--text-message-name-size': '14px',
  '--text-message-name-weight': '600',
  '--text-message-name-leading': 'normal',
  '--text-message-name-tracking': '0.01em',

  // Settings section titles, For you card titles.
  '--text-heading-family': fonts['--font-sans'],
  '--text-heading-size': '15px',
  '--text-heading-weight': '600',
  '--text-heading-leading': '1.35',
  '--text-heading-tracking': '0.01em',

  // Topic header title and its rename input.
  '--text-topic-title-family': fonts['--font-sans'],
  '--text-topic-title-size': '20px',
  '--text-topic-title-weight': '600',
  '--text-topic-title-leading': '1.3',
  '--text-topic-title-tracking': '-0.01em',

  // Page titles: New message, For you, Notifications, Preferences.
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
 * Feedback is instant or 150ms. Reduced motion collapses the durations and
 * the press scale, so components can use these without a media query.
 */
export const motion = stylex.defineVars({
  '--duration-fast': {
    default: '150ms',
    [REDUCED_MOTION]: '0.01ms',
  },
  '--ease-out': 'ease-out',
  '--press-scale': {
    default: '0.96',
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
  '--tab-min-width': '72px',
  '--topic-header-height': '95px',
  '--reading-width': '800px',
  '--composer-width': '752px',
  '--composer-max-height': '194px',
  '--assistant-input-max-height': '160px',
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
  '--popover-max-height': '400px',
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
  '--initials-stack': '7.5px',

  '--icon-11': '11px',
  '--icon-12': '12px',
  '--icon-13': '13px',
  '--icon-14': '14px',
  '--icon-15': '15px',
  '--icon-16': '16px',
  '--icon-18': '18px',
  '--icon-stroke': '2px',

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
