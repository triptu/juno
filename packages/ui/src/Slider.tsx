import * as stylex from '@stylexjs/stylex'
import type { InputHTMLAttributes } from 'react'
import { accent, colors, radii, sizes } from '@juno/tokens/tokens.stylex'
import { interactive } from './internal/interactive'

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
 * A range input with a 4px track and a 14px thumb. The thumb and the filled
 * part of the track are ink (`--foreground-default`); the thumb carries a
 * 2px ring in the page colour so it reads on the track in both themes.
 */
export function Slider({ min, max, step = 1, value, label, valueText, disabled, ...rest }: SliderProps) {
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
      disabled={disabled}
      {...rest}
      {...stylex.props(styles.input, styles.fill(percent), disabled && interactive.dimmed)}
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
    cursor: 'default',
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
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
      backgroundColor: colors['--foreground-default'],
      boxShadow: `0 0 0 ${sizes['--focus-ring-width']} ${colors['--background']}`,
    },
  },
  fill: (percent: number) => ({
    '::-webkit-slider-runnable-track': {
      backgroundImage: `linear-gradient(to right, ${colors['--foreground-default']} ${percent}%, ${colors['--secondary-active']} ${percent}%)`,
    },
  }),
})
