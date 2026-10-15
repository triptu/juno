import * as stylex from '@stylexjs/stylex'
import { accent, colors, spacing } from '@juno/tokens/tokens.stylex'
import { variants as typeVariants } from './internal/type'

export interface DividerProps {
  /** `default` for menus and hairlines, `subtle` between rows. */
  readonly tone?: 'default' | 'subtle'
  readonly vertical?: boolean
  /** Margin along the rule's axis, in spacing steps. */
  readonly inset?: 'none' | 'sm' | 'md' | 'lg'
}

/** A 1px rule. */
export function Divider({ tone = 'default', vertical = false, inset = 'none' }: DividerProps) {
  return (
    <hr
      aria-orientation={vertical ? 'vertical' : undefined}
      {...stylex.props(
        styles.base,
        vertical ? styles.vertical : styles.horizontal,
        tone === 'subtle' ? styles.subtle : styles.default,
        vertical ? insetVertical[inset] : insetHorizontal[inset],
      )}
    />
  )
}

export interface LabelledRuleProps {
  readonly label: string
  readonly tone?: 'accent' | 'muted'
}

/** The "3 new" divider: a label followed by a rule. */
export function LabelledRule({ label, tone = 'accent' }: LabelledRuleProps) {
  return (
    <div role="separator" aria-label={label} {...stylex.props(styles.labelled)}>
      <span {...stylex.props(typeVariants.divider, tone === 'accent' ? styles.labelAccent : styles.labelMuted)}>{label}</span>
      <span {...stylex.props(styles.rule, tone === 'accent' ? styles.ruleAccent : styles.ruleMuted)} />
    </div>
  )
}

const styles = stylex.create({
  base: {
    margin: 0,
    borderWidth: 0,
    flexShrink: 0,
  },
  horizontal: {
    width: '100%',
    height: '1px',
  },
  vertical: {
    width: '1px',
    alignSelf: 'stretch',
    minHeight: '1em',
  },
  default: { backgroundColor: colors['--border-default'] },
  subtle: { backgroundColor: colors['--border-subtle'] },
  labelled: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    // Fills the row so the rule runs the whole message column.
    width: '100%',
    userSelect: 'none',
  },
  labelAccent: { color: accent['--hl-text'] },
  labelMuted: { color: colors['--foreground-muted'] },
  rule: {
    flexGrow: 1,
    height: '1px',
  },
  ruleAccent: { backgroundColor: accent['--hl-rule'] },
  ruleMuted: { backgroundColor: colors['--border-default'] },
})

const insetHorizontal = stylex.create({
  none: {},
  sm: { marginBlock: spacing['--space-1'] },
  md: { marginBlock: spacing['--space-2'] },
  lg: { marginBlock: spacing['--space-3'] },
})

const insetVertical = stylex.create({
  none: {},
  sm: { marginInline: spacing['--space-1'] },
  md: { marginInline: spacing['--space-2'] },
  lg: { marginInline: spacing['--space-3'] },
})
