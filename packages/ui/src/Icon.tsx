import * as stylex from '@stylexjs/stylex'
import type { LucideIcon } from 'lucide-react'
import { opacity, sizes } from '@juno/tokens/tokens.stylex'

export type IconSize = 11 | 12 | 13 | 14 | 15 | 16 | 18

export interface IconProps {
  /** A lucide-react icon component, for example `Hash`. */
  readonly icon: LucideIcon
  /** Rendered size in px. Default 16. */
  readonly size?: IconSize
  /** Dim to the tab-icon opacity. */
  readonly dim?: boolean
  /**
   * Accessible name. Leave unset when the icon is decorative or when the
   * parent control already has a name; the icon is then hidden from
   * assistive technology.
   */
  readonly label?: string
}

/**
 * Lucide outline icon drawn in the surrounding text colour. Never filled.
 */
export function Icon({ icon: Lucide, size = 16, dim = false, label }: IconProps) {
  return (
    <Lucide
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
      {...stylex.props(styles.icon, sizeStyles[size], size <= 13 && styles.thin, dim && styles.dim)}
    />
  )
}

const styles = stylex.create({
  icon: {
    display: 'block',
    flexShrink: 0,
    stroke: 'currentColor',
    fill: 'none',
    strokeWidth: sizes['--icon-stroke'],
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    color: 'inherit',
  },
  // Small icons would look bold next to 11px text at the full stroke.
  thin: {
    strokeWidth: sizes['--icon-stroke-small'],
  },
  dim: {
    opacity: opacity['--opacity-tab-icon'],
  },
})

const sizeStyles = stylex.create({
  11: { width: sizes['--icon-11'], height: sizes['--icon-11'] },
  12: { width: sizes['--icon-12'], height: sizes['--icon-12'] },
  13: { width: sizes['--icon-13'], height: sizes['--icon-13'] },
  14: { width: sizes['--icon-14'], height: sizes['--icon-14'] },
  15: { width: sizes['--icon-15'], height: sizes['--icon-15'] },
  16: { width: sizes['--icon-16'], height: sizes['--icon-16'] },
  18: { width: sizes['--icon-18'], height: sizes['--icon-18'] },
})
