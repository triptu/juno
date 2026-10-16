import * as stylex from '@stylexjs/stylex'
import { accent, colors, motion, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Icon, type PhosphorIcon } from '@juno/ui'

export interface SuggestionChipProps {
  readonly icon: PhosphorIcon
  /** Verb-first, sentence case: the text the chip sends. */
  readonly label: string
  readonly onSend: () => void
}

const HOVER = '@media (hover: hover)'

/**
 * A suggestion Juno offers, as an action rather than a reply (SPEC
 * 13.1): a quiet outlined pill with a small icon, on whatever surface it
 * sits on. Clicking it sends its label as the owner's message. Used in
 * the empty chat.
 */
export function SuggestionChip({ icon, label, onSend }: SuggestionChipProps) {
  return (
    <button type="button" onClick={onSend} {...stylex.props(styles.chip)}>
      <span {...stylex.props(styles.icon)}>
        <Icon icon={icon} size={14} />
      </span>
      {label}
    </button>
  )
}

const styles = stylex.create({
  chip: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: spacing['--space-1-5'],
    boxSizing: 'border-box',
    height: sizes['--control-28'],
    margin: 0,
    // The icon's side 2px tighter, so the pill looks even around it.
    paddingInlineStart: spacing['--space-2-5'],
    paddingInlineEnd: spacing['--space-3'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--border-strong'],
      ':hover': { default: null, [HOVER]: colors['--border-strongest'] },
    },
    borderRadius: radii['--radius-pill'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
      ':active': colors['--surface-active'],
    },
    color: colors['--foreground-default'],
    fontFamily: text['--text-button-small-family'],
    fontSize: text['--text-button-small-size'],
    fontWeight: text['--text-button-small-weight'],
    lineHeight: text['--text-button-small-leading'],
    letterSpacing: text['--text-button-small-tracking'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
    cursor: 'default',
    transitionProperty: 'scale, background-color, border-color',
    transitionDuration: {
      default: motion['--duration-fast'],
      '@media (prefers-reduced-motion: reduce)': '0ms',
    },
    transitionTimingFunction: motion['--ease-out'],
    scale: {
      default: '1',
      ':active': motion['--press-scale'],
    },
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
    WebkitAppRegion: 'no-drag',
  },
  icon: {
    display: 'inline-flex',
    color: colors['--foreground-muted'],
  },
})
