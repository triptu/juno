import * as stylex from '@stylexjs/stylex'
import type { KeyboardEvent } from 'react'
import { colors, radii, shadows, sizes, spacing, weights } from '@juno/tokens/tokens.stylex'
import { activateHandlers } from './internal/activate'
import { focusRing } from './focusRing'
import { interactive } from './internal/interactive'
import { numeric, variants as typeVariants } from './internal/type'

const HOVER = '@media (hover: hover)'
// Segment side padding. A one-off between the 8px and 10px spacing steps.
const SEGMENT_PADDING_INLINE = '9px' // tokens-allow: between the 8 and 10 steps

export interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
  /** A count after the label, in muted tabular numbers ("Open 15"). */
  readonly count?: number
}

export interface SegmentedProps<T extends string> {
  readonly options: ReadonlyArray<SegmentedOption<T>>
  /** Null: nothing chosen yet. No segment is raised and the first one is the Tab stop. */
  readonly value: T | null
  readonly onChange: (value: T) => void
  readonly label: string
  readonly disabled?: boolean
}

/**
 * A small radio group drawn as a track with one raised segment. Each
 * segment is as wide as its label, with even gaps. A segment switches on
 * mouse down, like tabs (performance 4.1); arrow keys move the selection.
 */
export function Segmented<T extends string>({ options, value, onChange, label, disabled = false }: SegmentedProps<T>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const index = options.findIndex((option) => option.value === value)
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const next = options[(index + delta + options.length) % options.length]
    if (next) onChange(next.value)
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      {...stylex.props(styles.track, disabled && interactive.dimmed)}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        const tabStop = selected || (value === null && index === 0)
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={tabStop ? 0 : -1}
            disabled={disabled}
            aria-label={option.count === undefined ? undefined : `${option.label} ${option.count}`}
            {...activateHandlers<HTMLButtonElement>(() => onChange(option.value), { disabled })}
            {...stylex.props(
              interactive.reset,
              interactive.feedback,
              interactive.press,
              focusRing.inset,
              typeVariants.meta,
              styles.segment,
              selected && styles.selected,
            )}
          >
            {option.label}
            {option.count === undefined ? null : <span {...stylex.props(styles.count, numeric.tabular)}>{countLabel(option.count)}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Counts above 99 show as 99+, so a count never needs more than three digits of room. */
export function countLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}

const styles = stylex.create({
  track: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    padding: spacing['--space-0-5'],
    backgroundColor: colors['--surface-hover'],
    borderRadius: radii['--radius-md-plus'],
    userSelect: 'none',
    flexShrink: 0,
  },
  segment: {
    display: 'inline-flex',
    alignItems: 'center',
    height: sizes['--control-24'],
    paddingInline: SEGMENT_PADDING_INLINE,
    borderRadius: radii['--radius-sm'],
    fontWeight: weights['--weight-medium'],
    whiteSpace: 'nowrap',
    color: {
      default: colors['--foreground-muted'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
      ':disabled': colors['--foreground-muted'],
    },
  },
  count: {
    minWidth: '3ch', // tokens-allow: reserve three tabular digits (up to 99+) while live counts fill
    textAlign: 'end',
    marginInlineStart: spacing['--space-1-5'],
    fontWeight: weights['--weight-regular'],
    color: colors['--foreground-muted'],
  },
  selected: {
    color: colors['--foreground-default'],
    backgroundColor: colors['--surface-raised'],
    boxShadow: shadows['--shadow-sm'],
  },
})
