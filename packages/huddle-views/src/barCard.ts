import * as stylex from '@stylexjs/stylex'
import { colors, layout, radii, shadows, sizes, spacing } from '@juno/tokens/tokens.stylex'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

/**
 * The frosted accent card the sidebar's huddle bar and an incoming
 * huddle's card share (inventory 22.1 and 22.8): its place in the sidebar,
 * the material, the first row that opens the huddle's tab, and the visually
 * hidden announcement.
 */
export const barCard = stylex.create({
  // The sidebar's inset at the sides, and 4px above and below, so with the nav's own 4px it sits 8px over Juno.
  root: {
    flexShrink: 0,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    paddingInline: layout['--sidebar-inset'],
    paddingBlock: spacing['--space-1'],
    userSelect: 'none',
  },
  // A frosted card in the accent: a tinted fill with a sheen from the top, a hairline highlight inside the top
  // edge and an accent edge, so it stands apart from the sidebar and you can find the call quickly. No
  // backdrop blur: nothing scrolls or moves behind it. 4px around two 28px rows, 2px between them, as between the controls.
  // 12 = the controls' 8 + the 4 around them.
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    padding: spacing['--space-1'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--huddle-bar-edge'],
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--huddle-bar'],
    backgroundImage: colors['--huddle-bar-sheen'],
    boxShadow: shadows['--huddle-bar-shadow'],
    WebkitAppRegion: 'no-drag',
  },
  // Its glyph sits 6px in, over the Mute glyph's 6px inside its 28px button.
  // The faces' ring (the `background` one) takes the fill under them, so it cuts their overlap in the bar's
  // tint. Not --surface-default: the faces' own fills are mixed with it.
  // Muted falls under 4.5:1 on the light tint, so "+N" and the caret take subtle (4.78:1 or more).
  open: {
    '--foreground-muted': colors['--foreground-subtle'],
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    width: '100%',
    minWidth: 0,
    height: sizes['--control-28'],
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: spacing['--space-1-5'],
    paddingInlineEnd: spacing['--space-2'],
    boxSizing: 'border-box',
    borderWidth: 0,
    borderRadius: radii['--radius-lg'],
    color: colors['--foreground-default'],
    textAlign: 'start',
    cursor: 'default',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--huddle-bar-hover'] },
      ':active': { default: colors['--huddle-bar-hover'], [HOVER]: colors['--huddle-bar-hover'] },
    },
    '--background': {
      default: colors['--huddle-bar'],
      ':hover': { default: null, [HOVER]: colors['--huddle-bar-hover'] },
      ':active': { default: colors['--huddle-bar-hover'], [HOVER]: colors['--huddle-bar-hover'] },
    },
    transitionProperty: 'background-color',
    transitionDuration: '0s',
  },
  placeIcon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-subtle'],
  },
  // The name keeps its room first; a long status line shortens before it does.
  name: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  spacer: {
    flexGrow: 1,
  },
  caret: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  // Heard, not seen: what changed, never the ticking duration.
  announce: {
    position: 'absolute',
    width: '1px', // tokens-allow: the visually hidden pattern
    height: '1px', // tokens-allow: the visually hidden pattern
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
})
