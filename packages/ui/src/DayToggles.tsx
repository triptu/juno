import * as stylex from '@stylexjs/stylex'
import { colors, radii, sizes, spacing, weights } from '@juno/tokens/tokens.stylex'
import { focusRing } from './focusRing'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'

const HOVER = '@media (hover: hover)'

/** 0 is Sunday, as `Date.prototype.getDay`. */
export type DayNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface DayTogglesProps {
  /** The days that are on. */
  readonly days: ReadonlyArray<DayNumber>
  readonly onChange: (day: DayNumber, enabled: boolean) => void
  /** Names the group: "Notification days". */
  readonly label: string
}

/** Monday first, as the hours rows read (inventory 13). */
const order: ReadonlyArray<{ readonly day: DayNumber; readonly letter: string; readonly name: string }> = [
  { day: 1, letter: 'M', name: 'Monday' },
  { day: 2, letter: 'T', name: 'Tuesday' },
  { day: 3, letter: 'W', name: 'Wednesday' },
  { day: 4, letter: 'T', name: 'Thursday' },
  { day: 5, letter: 'F', name: 'Friday' },
  { day: 6, letter: 'S', name: 'Saturday' },
  { day: 0, letter: 'S', name: 'Sunday' },
]

/**
 * Seven round day toggles, Monday first (inventory 13, Hours). An on day
 * is filled; an off day is muted text. Each is a toggle button named by
 * its day.
 */
export function DayToggles({ days, onChange, label }: DayTogglesProps) {
  const toggle = (day: DayNumber) => onChange(day, !days.includes(day))
  return (
    <div role="group" aria-label={label} {...stylex.props(styles.group)}>
      {order.map(({ day, letter, name }) => {
        const on = days.includes(day)
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={name}
            title={name}
            onClick={() => toggle(day)}
            {...stylex.props(interactive.reset, interactive.feedback, interactive.press, focusRing.outside, typeVariants.tagSmall, styles.day, on && styles.on)}
          >
            {letter}
          </button>
        )
      })}
    </div>
  )
}

const styles = stylex.create({
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
  },
  day: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--control-28'],
    height: sizes['--control-28'],
    borderRadius: radii['--radius-full'],
    fontWeight: weights['--weight-medium'],
    textAlign: 'center',
    cursor: 'default',
    color: {
      default: colors['--foreground-muted'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  on: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
})
