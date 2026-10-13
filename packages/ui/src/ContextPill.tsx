import * as stylex from '@stylexjs/stylex'
import { radii, sizes, spacing, tints, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize, type PhosphorIcon } from './Icon'
import { variants as typeVariants } from './internal/type'

/** The three context tints from the tokens: neutral, amber and blue. */
export type ContextTint = 'public' | 'private' | 'dm'
export type ContextPillSize = 22 | 26 | 28

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
  readonly size?: ContextPillSize
}

const iconBySize: Record<ContextPillSize, IconSize> = { 22: 12, 26: 14, 28: 14 }

/**
 * The tinted pill that says where a topic lives. The owner maps the
 * conversation kind to a tint, an icon and a label (that rule lives in
 * `@juno/domain`); the pill only draws them.
 */
export function ContextPill({ tint, icon, name, kindLabel, showKind = false, size = 26 }: ContextPillProps) {
  return (
    <span title={kindLabel} {...stylex.props(styles.base, typeVariants.pill, sizeStyles[size], tintStyles[tint])}>
      <Icon icon={icon} size={iconBySize[size]} />
      <span {...stylex.props(styles.name)}>{name}</span>
      {showKind && kindLabel ? (
        <span {...stylex.props(styles.kind)}>
          <span aria-hidden>{' · '}</span>
          {kindLabel}
        </span>
      ) : null}
    </span>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
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
  26: { height: sizes['--control-26'] },
  28: { height: sizes['--control-28'] },
})

const tintStyles = stylex.create({
  public: { color: tints['--tint-public-fg'], backgroundColor: tints['--tint-public-bg'] },
  private: { color: tints['--tint-private-fg'], backgroundColor: tints['--tint-private-bg'] },
  dm: { color: tints['--tint-dm-fg'], backgroundColor: tints['--tint-dm-bg'] },
})
