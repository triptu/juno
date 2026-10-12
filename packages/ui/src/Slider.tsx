import * as stylex from '@stylexjs/stylex'
import type { InputHTMLAttributes } from 'react'
import { colors, radii, shadows, sizes } from '@juno/tokens/tokens.stylex'

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style' | 'className' | 'type' | 'value' | 'min' | 'max' | 'step'> {
  readonly min: number
  readonly max: number
  readonly step?: number
  readonly value: number
  readonly label: string
  /** Text read with the value, for example "%". */
  readonly valueText?: string
}

/**
 * A range input with a 4px track and a 14px ringed thumb. The filled part of
 * the track is painted with a gradient from the current value.
 */
export function Slider({ min, max, step = 1, value, label, valueText, ...rest }: SliderProps) {
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={valueText}
      {...rest}
      {...stylex.props(styles.input, styles.fill(percent))}
    />
  )
}

const styles = stylex.create({
  input: {
    appearance: 'none',
    width: sizes['--slider-width'],
    height: sizes['--slider-thumb'],
    margin: 0,
    padding: 0,
    backgroundColor: 'transparent',
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: colors['--focus-ring'],
    borderRadius: radii['--radius-full'],
    '::-webkit-slider-runnable-track': {
      height: sizes['--slider-track'],
      borderRadius: radii['--radius-full'],
    },
    '::-webkit-slider-thumb': {
      appearance: 'none',
      width: sizes['--slider-thumb'],
      height: sizes['--slider-thumb'],
      marginTop: `calc((${sizes['--slider-track']} - ${sizes['--slider-thumb']}) / 2)`,
      borderRadius: radii['--radius-full'],
      backgroundColor: colors['--surface-default'],
      boxShadow: shadows['--card-ring'],
    },
  },
  fill: (percent: number) => ({
    '::-webkit-slider-runnable-track': {
      backgroundImage: `linear-gradient(to right, ${colors['--foreground-default']} ${percent}%, ${colors['--border-strong']} ${percent}%)`,
    },
  }),
})
