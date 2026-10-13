import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import type { ButtonHTMLAttributes } from 'react'
import { colors, radii, sizes } from '@juno/tokens/tokens.stylex'
import { hueStyles } from './Avatar'
import { Icon } from './Icon'
import type { HueName } from './internal/hue'
import { interactive } from './internal/interactive'

export interface SwatchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'children'> {
  readonly hue: HueName
  /** Required accessible name, for example "Claret". */
  readonly label: string
  /** The chosen one. Shows a filled check and sets aria-pressed. */
  readonly selected?: boolean
}

/**
 * A round colour choice (a channel colour, later an accent): a 24px disc in
 * the hue's avatar mix, a bold check when selected. Arrow cursor, press
 * scale, keyboard focus ring like every control.
 */
export function Swatch({ hue, label, selected = false, type = 'button', ...rest }: SwatchProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={selected}
      {...rest}
      {...stylex.props(interactive.reset, interactive.feedback, interactive.press, interactive.focusRing, styles.swatch, hueStyles[hue], selected && styles.selected)}
    >
      {selected ? <Icon icon={Check} size={13} weight="bold" /> : null}
    </button>
  )
}

const styles = stylex.create({
  swatch: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-24'],
    height: sizes['--control-24'],
    borderRadius: radii['--radius-full'],
    verticalAlign: 'middle',
  },
  // A 2px ring in the text colour, offset by the surface so it reads as a
  // ring and not a border.
  selected: {
    boxShadow: `0 0 0 ${sizes['--focus-ring-width']} ${colors['--surface-default']}, 0 0 0 calc(${sizes['--focus-ring-width']} * 2) ${colors['--foreground-default']}`,
  },
})
