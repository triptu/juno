import * as stylex from '@stylexjs/stylex'
import type { KeyboardEvent } from 'react'
import { colors, radii, shadows, sizes, spacing, weights } from '@juno/tokens/tokens.stylex'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'

const HOVER = '@media (hover: hover)'
// Segment side padding. A one-off between the 8px and 10px spacing steps.
const SEGMENT_PADDING_INLINE = '9px'

export interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
}

export interface SegmentedProps<T extends string> {
  readonly options: ReadonlyArray<SegmentedOption<T>>
  readonly value: T
  readonly onChange: (value: T) => void
  readonly label: string
  readonly disabled?: boolean
}

/**
 * A small radio group drawn as a track with one raised segment. Arrow keys
 * move the selection.
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
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            {...stylex.props(
              interactive.reset,
              interactive.feedback,
              interactive.press,
              interactive.focusRingInset,
              typeVariants.meta,
              styles.segment,
              selected && styles.selected,
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
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
  selected: {
    color: colors['--foreground-default'],
    backgroundColor: colors['--surface-raised'],
    boxShadow: shadows['--shadow-sm'],
  },
})
