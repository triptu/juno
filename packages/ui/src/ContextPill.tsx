import * as stylex from '@stylexjs/stylex'
import { Hash, Lock, User, Users } from 'lucide-react'
import { radii, sizes, spacing, tints, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize } from './Icon'
import { roles } from './internal/type'

export type ContextKind = 'public' | 'private' | 'dm' | 'group'
export type ContextPillSize = 22 | 26 | 28

export interface ContextPillProps {
  readonly kind: ContextKind
  /** Channel or person name without the "#". */
  readonly name: string
  /** Appends " · Public channel" and so on at regular weight. */
  readonly showKind?: boolean
  readonly size?: ContextPillSize
}

const icons = { public: Hash, private: Lock, dm: User, group: Users } as const

export const contextKindLabel: Record<ContextKind, string> = {
  public: 'Public channel',
  private: 'Private channel',
  dm: 'Direct message',
  group: 'Group DM',
}

const iconBySize: Record<ContextPillSize, IconSize> = { 22: 11, 26: 13, 28: 13 }

/** The tinted pill that says where a topic lives. */
export function ContextPill({ kind, name, showKind = false, size = 26 }: ContextPillProps) {
  return (
    <span title={contextKindLabel[kind]} {...stylex.props(styles.base, roles.pill, sizeStyles[size], tintStyles[kind])}>
      <Icon icon={icons[kind]} size={iconBySize[size]} />
      <span {...stylex.props(styles.name)}>{name}</span>
      {showKind ? (
        <span {...stylex.props(styles.kind)}>
          <span aria-hidden>{' · '}</span>
          {contextKindLabel[kind]}
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
    borderRadius: radii['--radius-md'],
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
  group: { color: tints['--tint-dm-fg'], backgroundColor: tints['--tint-dm-bg'] },
})
