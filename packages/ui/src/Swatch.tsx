import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import type { ButtonHTMLAttributes } from 'react'
import { accentSwatches, colors, radii, sizes } from '@juno/tokens/tokens.stylex'
import { hueStyles } from './Avatar'
import { Icon } from './Icon'
import type { HueName } from './internal/hue'
import { focusRing } from './focusRing'
import { interactive } from './internal/interactive'
import { tintFills, type IconTint } from './internal/tint'
import { tooltip } from './Tooltip'
import type { AccentName } from './theme'

interface SwatchBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'children'> {
  /** Required accessible name, for example "Claret". */
  readonly label: string
  /** The chosen one. Shows a filled check and sets aria-pressed. */
  readonly selected?: boolean
}

export interface HueSwatchProps extends SwatchBaseProps {
  /** A person or channel colour, drawn in the avatar mix. */
  readonly hue: HueName
  readonly accent?: undefined
  readonly tint?: undefined
}

export interface AccentSwatchProps extends SwatchBaseProps {
  readonly hue?: undefined
  /** An accent, drawn as its solid fill with its text colour for the check. */
  readonly accent: AccentName
  readonly tint?: undefined
}

export interface TintSwatchProps extends SwatchBaseProps {
  readonly hue?: undefined
  readonly accent?: undefined
  /** An icon tint, drawn in the colour the icon takes (`Button iconTint`). */
  readonly tint: IconTint
}

export type SwatchProps = HueSwatchProps | AccentSwatchProps | TintSwatchProps

/**
 * A round colour choice: a 24px disc, a bold check when selected. A `hue`
 * swatch is a person or channel colour in the avatar mix; an `accent`
 * swatch is the accent's solid fill; a `tint` swatch is an icon tint. Arrow cursor, press scale, keyboard
 * focus ring like every control.
 */
export function Swatch({ hue, accent, tint, label, selected = false, type = 'button', ...rest }: SwatchProps) {
  return (
    <button
      type={type}
      aria-label={label}
      {...tooltip(label)}
      aria-pressed={selected}
      {...rest}
      {...stylex.props(
        interactive.reset,
        interactive.feedback,
        interactive.press,
        focusRing.outside,
        styles.swatch,
        hue !== undefined && hueStyles[hue],
        accent !== undefined && accentStyles[accent],
        tint !== undefined && tintFills[tint],
        tint !== undefined && styles.onTint,
        selected && styles.selected,
      )}
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
  // The check on a tint: the page colour, which is the far end of the scale from every tint in both themes.
  onTint: {
    color: colors['--background'],
  },
  // A 2px ring in the text colour, offset by the surface so it reads as a
  // ring and not a border.
  selected: {
    boxShadow: `0 0 0 ${sizes['--focus-ring-width']} ${colors['--surface-default']}, 0 0 0 calc(${sizes['--focus-ring-width']} * 2) ${colors['--foreground-default']}`,
  },
})

const accentStyles = stylex.create({
  coral: { backgroundColor: accentSwatches['--swatch-coral'], color: accentSwatches['--swatch-coral-fg'] },
  ink: { backgroundColor: accentSwatches['--swatch-ink'], color: accentSwatches['--swatch-ink-fg'] },
  marigold: { backgroundColor: accentSwatches['--swatch-marigold'], color: accentSwatches['--swatch-marigold-fg'] },
  teal: { backgroundColor: accentSwatches['--swatch-teal'], color: accentSwatches['--swatch-teal-fg'] },
  midnight: { backgroundColor: accentSwatches['--swatch-midnight'], color: accentSwatches['--swatch-midnight-fg'] },
  emerald: { backgroundColor: accentSwatches['--swatch-emerald'], color: accentSwatches['--swatch-emerald-fg'] },
  claret: { backgroundColor: accentSwatches['--swatch-claret'], color: accentSwatches['--swatch-claret-fg'] },
  cyan: { backgroundColor: accentSwatches['--swatch-cyan'], color: accentSwatches['--swatch-cyan-fg'] },
})
