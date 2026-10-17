import * as stylex from '@stylexjs/stylex'
import { radii, sizes, spacing, text, tints, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize, type PhosphorIcon } from './Icon'
import { focusRing } from './focusRing'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

/** The three context tints from the tokens: neutral, amber and blue. */
export type ContextTint = 'public' | 'private' | 'dm'
export type ContextPillSize = 22 | 24 | 26 | 28

export interface ContextPillProps {
  readonly tint: ContextTint
  /** The icon for the kind of place: Hash, Lock, User, Users. */
  readonly icon: PhosphorIcon
  /** Channel or person name without the "#". */
  readonly name: string
  /** The kind, appended after a dot at regular weight ("Public channel"). Also the tooltip. */
  readonly kindLabel?: string
  /** Append `kindLabel` to the visible text. */
  readonly showKind?: boolean
  /** 22 on cards, 24 in a page header, 26 by default, 28 in the To field. */
  readonly size?: ContextPillSize
  /** Makes the pill a button (the page header's: narrow the sidebar to the channel). */
  readonly onClick?: () => void
  /** The button's accessible name, which carries the kind when it is not shown ("eng, public channel. Show in sidebar."). */
  readonly label?: string
}

const iconBySize: Record<ContextPillSize, IconSize> = { 22: 12, 24: 13, 26: 14, 28: 14 }

/**
 * The tinted pill that says where a topic lives. The owner maps the
 * conversation kind to a tint, an icon and a label (that rule lives in
 * `@juno/domain`); the pill only draws them. It shrinks with its row: the
 * name takes an ellipsis, the icon and the kind keep their size, and the
 * pill never gets narrower than those two, so nothing spills out of it.
 */
export function ContextPill({ tint, icon, name, kindLabel, showKind = false, size = 26, onClick, label }: ContextPillProps) {
  const kind = showKind && kindLabel ? kindLabel : undefined
  const content = (
    <>
      <Icon icon={icon} size={iconBySize[size]} />
      <span {...stylex.props(styles.name)}>{name}</span>
      {kind !== undefined ? (
        <span {...stylex.props(styles.kind)}>
          <span aria-hidden>{' · '}</span>
          {kind}
        </span>
      ) : null}
    </>
  )
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        title={kindLabel}
        aria-label={label}
        onClick={onClick}
        {...stylex.props(interactive.reset, interactive.feedback, interactive.press, focusRing.outside, styles.base, kind !== undefined && styles.withKind, typeVariants.pill, sizeStyles[size], tintStyles[tint], hoverStyles[tint])}
      >
        {content}
      </button>
    )
  }
  return (
    <span title={kindLabel} {...stylex.props(styles.base, kind !== undefined && styles.withKind, typeVariants.pill, sizeStyles[size], tintStyles[tint])}>
      {content}
    </span>
  )
}

const styles = stylex.create({
  // A grid, so that the name's track gives way to zero while the icon's and
  // the kind's keep their width: its min-content is icon + kind + padding.
  base: {
    display: 'inline-grid',
    gridTemplateColumns: 'auto minmax(0, max-content)',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing['--space-1-5'],
    paddingInline: spacing['--space-2-5'],
    borderRadius: radii['--radius-pill'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
    verticalAlign: 'middle',
    minWidth: 'min-content',
    maxWidth: '100%',
  },
  withKind: {
    gridTemplateColumns: 'auto minmax(0, max-content) auto',
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
  kind: {
    fontWeight: weights['--weight-regular'],
  },
})

const sizeStyles = stylex.create({
  22: { height: sizes['--control-22'], paddingInline: spacing['--space-2'], gap: spacing['--space-1'] },
  24: { height: sizes['--control-24'], paddingInline: spacing['--space-2'], gap: spacing['--space-1-5'], fontSize: text['--text-meta-size'], lineHeight: sizes['--control-24'] },
  26: { height: sizes['--control-26'] },
  28: { height: sizes['--control-28'] },
})

// Only a pill that does something answers the pointer.
const hoverStyles = stylex.create({
  public: { backgroundColor: { default: tints['--tint-public-bg'], ':hover': { default: null, [HOVER]: tints['--tint-public-hover'] } } },
  private: { backgroundColor: { default: tints['--tint-private-bg'], ':hover': { default: null, [HOVER]: tints['--tint-private-hover'] } } },
  dm: { backgroundColor: { default: tints['--tint-dm-bg'], ':hover': { default: null, [HOVER]: tints['--tint-dm-hover'] } } },
})

const tintStyles = stylex.create({
  public: { color: tints['--tint-public-fg'], backgroundColor: tints['--tint-public-bg'] },
  private: { color: tints['--tint-private-fg'], backgroundColor: tints['--tint-private-bg'] },
  dm: { color: tints['--tint-dm-fg'], backgroundColor: tints['--tint-dm-bg'] },
})
