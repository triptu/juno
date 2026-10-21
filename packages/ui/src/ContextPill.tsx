import * as stylex from '@stylexjs/stylex'
import { radii, sizes, spacing, text, tints, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize, type PhosphorIcon } from './Icon'
import { focusRing } from './focusRing'
import { PresenceDot } from './PresenceDot'
import { interactive } from './internal/interactive'
import { tooltip } from './Tooltip'
import { variants as typeVariants } from './internal/type'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'
// A page header's narrow form (HeaderIslands is the size container).
const NARROW = '@container (width < 480px)'

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
  /**
   * In a page header: under the header's 480px width the pill is its icon
   * alone, a round control as tall as the pill, and the title takes the
   * room. The name stays in the accessible name and the tooltip says the
   * name and the kind in both forms.
   */
  readonly iconWhenNarrow?: boolean
  /**
   * A DM's person, when Slack has said: a dot takes the icon's place, green
   * when active and hollow when away, in the icon's box so nothing moves.
   * The tooltip says it in words; a button's `label` should too.
   */
  readonly presence?: 'active' | 'away'
}

const iconBySize: Record<ContextPillSize, IconSize> = { 22: 12, 24: 13, 26: 14, 28: 14 }

/**
 * The tinted pill that says where a topic lives. The owner maps the
 * conversation kind to a tint, an icon and a label (that rule lives in
 * `@juno/domain`); the pill only draws them. It shrinks with its row: the
 * name takes an ellipsis, the icon and the kind keep their size, and the
 * pill never gets narrower than those two, so nothing spills out of it.
 */
export function ContextPill({ tint, icon, name, kindLabel, showKind = false, size = 26, onClick, label, iconWhenNarrow = false, presence }: ContextPillProps) {
  const kind = showKind && kindLabel ? kindLabel : undefined
  const presenceWord = presence === undefined ? undefined : presence === 'active' ? 'Active' : 'Away'
  const hintKind = [kindLabel, presenceWord].filter((part) => part !== undefined).join(' · ') || undefined
  // The tooltip names the place too when the name can be hidden; otherwise the native title says the kind, as before.
  const hint = iconWhenNarrow ? tooltip(hintKind === undefined ? name : `${name} · ${hintKind}`) : { title: hintKind }
  const content = (
    <>
      {presence === undefined ? (
        <Icon icon={icon} size={iconBySize[size]} />
      ) : (
        <span data-pill-presence={presence} {...stylex.props(styles.dotSlot, slot.box(iconBySize[size]))}>
          <PresenceDot active={presence === 'active'} surface="inline" />
        </span>
      )}
      <span {...stylex.props(styles.name, iconWhenNarrow && kind === undefined && styles.nameNarrow)}>{name}</span>
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
        {...hint}
        aria-label={label}
        onClick={onClick}
        {...stylex.props(interactive.reset, interactive.feedback, interactive.press, focusRing.outside, styles.base, kind !== undefined && styles.withKind, typeVariants.pill, sizeStyles[size], tintStyles[tint], hoverStyles[tint], iconWhenNarrow && kind === undefined && narrowStyles[size])}
      >
        {content}
      </button>
    )
  }
  return (
    <span {...hint} {...stylex.props(styles.base, kind !== undefined && styles.withKind, typeVariants.pill, sizeStyles[size], tintStyles[tint], iconWhenNarrow && kind === undefined && narrowStyles[size])}>
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
  dotSlot: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Out of sight in the narrow form but still read, so a pill that is not a
  // button keeps its name. Every property states its wide value too: a
  // `null` default would drop the value set before it.
  nameNarrow: {
    position: { default: 'static', [NARROW]: 'absolute' },
    width: {
      default: 'auto',
      [NARROW]: '1px', // tokens-allow: the standard visually hidden box
    },
    height: {
      default: 'auto',
      [NARROW]: '1px', // tokens-allow: the standard visually hidden box
    },
    clipPath: { default: 'none', [NARROW]: 'inset(50%)' },
  },
})

// The narrow form: the icon centred in a circle as tall as the pill. Not
// with `showKind`, whose grid has a third column.
const narrowStyles = stylex.create({
  22: { gridTemplateColumns: { default: 'auto minmax(0, max-content)', [NARROW]: 'auto' }, justifyContent: { default: 'normal', [NARROW]: 'center' }, width: { default: 'auto', [NARROW]: sizes['--control-22'] }, paddingInline: { default: spacing['--space-2'], [NARROW]: 0 } },
  24: { gridTemplateColumns: { default: 'auto minmax(0, max-content)', [NARROW]: 'auto' }, justifyContent: { default: 'normal', [NARROW]: 'center' }, width: { default: 'auto', [NARROW]: sizes['--control-24'] }, paddingInline: { default: spacing['--space-2'], [NARROW]: 0 } },
  26: { gridTemplateColumns: { default: 'auto minmax(0, max-content)', [NARROW]: 'auto' }, justifyContent: { default: 'normal', [NARROW]: 'center' }, width: { default: 'auto', [NARROW]: sizes['--control-26'] }, paddingInline: { default: spacing['--space-2-5'], [NARROW]: 0 } },
  28: { gridTemplateColumns: { default: 'auto minmax(0, max-content)', [NARROW]: 'auto' }, justifyContent: { default: 'normal', [NARROW]: 'center' }, width: { default: 'auto', [NARROW]: sizes['--control-28'] }, paddingInline: { default: spacing['--space-2-5'], [NARROW]: 0 } },
})

// The icon's box, which the presence dot keeps, so the pill is as wide either way.
const slot = stylex.create({ box: (px: IconSize) => ({ width: px, height: px }) })

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
