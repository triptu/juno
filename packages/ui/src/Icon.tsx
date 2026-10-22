import * as stylex from '@stylexjs/stylex'
import type { Icon as PhosphorIcon, IconWeight as PhosphorWeight } from '@phosphor-icons/react'
import { opacity, sizes } from '@juno/tokens/tokens.stylex'

export type { PhosphorIcon }

/**
 * `regular` for chrome at 15px and up, `bold` at 14px and below (regular
 * drops under 1px there and goes faint next to 11–12px text), `fill` for
 * active and selected states only. Duotone, for the few deliberate friendly
 * spots (the Juno sparkle), is not a weight here: it comes with the icon,
 * from `duotone.ts`.
 */
export type IconWeight = 'regular' | 'bold' | 'fill'
export type IconSize = 12 | 13 | 14 | 15 | 16 | 18 | 20

export interface IconProps {
  /** A Phosphor icon component, for example `Hash`. */
  readonly icon: PhosphorIcon
  /** Rendered size in px. Default 16. */
  readonly size?: IconSize
  /** Default: bold at 14 and below, regular at 15 and above. */
  readonly weight?: IconWeight
  /** Shorthand for `weight="fill"`: the outline/fill pair of a toggle. */
  readonly active?: boolean
  /** Dim to the tab-icon opacity. */
  readonly dim?: boolean
  /**
   * Accessible name. Leave unset when the icon is decorative or when the
   * parent control already has a name; the icon is then hidden from
   * assistive technology.
   */
  readonly label?: string
  /**
   * Draws an odd size in a box 1px larger, with half a pixel of room each
   * side, for an icon centred in an even box: `both` in a square button (a
   * 15px icon in a 24px one), `block` beside a label (a 13px icon in a 22px
   * button). The browser puts an SVG's box on whole pixels, so an odd box
   * there would draw half a pixel low (and right).
   */
  readonly evenBox?: 'both' | 'block'
}

/** The weight a size gets when none is named. */
export function defaultIconWeight(size: IconSize): IconWeight {
  return size <= 14 ? 'bold' : 'regular'
}

/**
 * A Phosphor icon drawn in the surrounding text colour. Outline by default;
 * fill marks state. The weight comes from the size unless named, so call
 * sites only say `fill`. A duotone icon (`duotone.ts`) draws duotone whatever the weight.
 */
export function Icon({ icon: Glyph, size = 16, weight, active = false, dim = false, label, evenBox }: IconProps) {
  const resolved: PhosphorWeight = weight ?? (active ? 'fill' : defaultIconWeight(size))
  const padBlock = evenBox !== undefined && size % 2 === 1
  const padInline = evenBox === 'both' && padBlock
  // Half a pixel at this size, in the icon's 256-unit grid.
  const half = 128 / size
  const width = (padInline ? size + 1 : size) as IconSize
  const height = (padBlock ? size + 1 : size) as IconSize
  return (
    <Glyph
      size={size}
      {...(padBlock
        ? {
            width,
            height,
            viewBox: `${padInline ? -half : 0} ${-half} ${padInline ? 256 + 2 * half : 256} ${256 + 2 * half}`,
          }
        : {})}
      weight={resolved}
      color="currentColor"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
      {...stylex.props(styles.icon, widths[width], heights[height], dim && styles.dim)}
    />
  )
}

const styles = stylex.create({
  icon: {
    display: 'block',
    flexShrink: 0,
    color: 'inherit',
  },
  dim: {
    opacity: opacity['--opacity-tab-icon'],
  },
})

const widths = stylex.create({
  12: { width: sizes['--icon-12'] },
  13: { width: sizes['--icon-13'] },
  14: { width: sizes['--icon-14'] },
  15: { width: sizes['--icon-15'] },
  16: { width: sizes['--icon-16'] },
  18: { width: sizes['--icon-18'] },
  20: { width: sizes['--icon-20'] },
})

const heights = stylex.create({
  12: { height: sizes['--icon-12'] },
  13: { height: sizes['--icon-13'] },
  14: { height: sizes['--icon-14'] },
  15: { height: sizes['--icon-15'] },
  16: { height: sizes['--icon-16'] },
  18: { height: sizes['--icon-18'] },
  20: { height: sizes['--icon-20'] },
})
