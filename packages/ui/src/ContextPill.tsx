import * as stylex from '@stylexjs/stylex'
import { radii, sizes, spacing, text, tints, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize, type PhosphorIcon } from './Icon'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'

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
 * name takes an ellipsis, the icon and the kind keep their size.
 */
export function ContextPill({ tint, icon, name, kindLabel, showKind = false, size = 26, onClick, label }: ContextPillProps) {
  const content = (
    <>
      <Icon icon={icon} size={iconBySize[size]} />
      <span {...stylex.props(styles.name)}>{name}</span>
      {showKind && kindLabel ? (
        <span {...stylex.props(styles.kind)}>
          <span aria-hidden>{' · '}</span>
          {kindLabel}
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
        {...stylex.props(interactive.reset, interactive.feedback, interactive.press, interactive.focusRing, styles.base, typeVariants.pill, sizeStyles[size], tintStyles[tint])}
      >
        {content}
      </button>
    )
  }
  return (
    <span title={kindLabel} {...stylex.props(styles.base, typeVariants.pill, sizeStyles[size], tintStyles[tint])}>
      {content}
    </span>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing['--space-1-5'],
    paddingInline: spacing['--space-2-5'],
    borderRadius: radii['--radius-pill'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
    verticalAlign: 'middle',
    minWidth: 0,
    maxWidth: '100%',
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
  kind: {
    fontWeight: weights['--weight-regular'],
    flexShrink: 0,
  },
})

const sizeStyles = stylex.create({
  22: { height: sizes['--control-22'], paddingInline: spacing['--space-2'], gap: spacing['--space-1'] },
  24: { height: sizes['--control-24'], paddingInline: spacing['--space-2'], gap: spacing['--space-1-5'], fontSize: text['--text-meta-size'], lineHeight: sizes['--control-24'] },
  26: { height: sizes['--control-26'] },
  28: { height: sizes['--control-28'] },
})

const tintStyles = stylex.create({
  public: { color: tints['--tint-public-fg'], backgroundColor: tints['--tint-public-bg'] },
  private: { color: tints['--tint-private-fg'], backgroundColor: tints['--tint-private-bg'] },
  dm: { color: tints['--tint-dm-fg'], backgroundColor: tints['--tint-dm-bg'] },
})
