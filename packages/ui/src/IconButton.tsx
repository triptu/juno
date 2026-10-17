import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes } from 'react'
import { accent, colors, motion, radii, shadows, sizes } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize, type IconWeight, type PhosphorIcon } from './Icon'
import { interactive } from './internal/interactive'
import { tintColors, type IconTint } from './internal/tint'
import { tooltip } from './Tooltip'

export type IconButtonSize = 20 | 22 | 26 | 28 | 30 | 32 | 36
export type IconButtonRadius = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
/** `island`: a control in a page header's island (inventory 5), with the island's own hover and pressed fills. */
export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'raised' | 'island'
export type IconButtonTone = 'default' | 'subtle' | 'muted'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'children'> {
  readonly icon: PhosphorIcon
  /** Required accessible name; also the tooltip. */
  readonly label: string
  /** The shortcut that does the same ("⌘["): keycaps in the tooltip, and the end of the accessible name. */
  readonly shortcut?: string
  readonly size?: IconButtonSize
  readonly iconSize?: IconSize
  /** Draws the icon in an accent's colour (the view sheet's chosen icon). Not with `pressed`. */
  readonly iconTint?: IconTint
  /** Icon weight override (`bold` for the send arrow). Default by icon size, `fill` when pressed. */
  readonly iconWeight?: IconWeight
  readonly radius?: IconButtonRadius
  readonly variant?: IconButtonVariant
  readonly tone?: IconButtonTone
  /**
   * Toggle state (subscribed, pinned). Sets aria-pressed and fills the icon;
   * the fill pops in with the spring, toggling off just cross-fades.
   */
  readonly pressed?: boolean
  /** A menu button whose menu is showing: `aria-expanded`, drawn as pressed. */
  readonly expanded?: boolean
  /** Opens a page and that page is the current tab: `aria-current="page"`, the nav's accent tint and the filled icon, as an active NavItem. */
  readonly current?: boolean
  readonly dimmed?: boolean
  /** No tooltip, when the label would repeat visible text. */
  readonly noTooltip?: boolean
}

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

// The 28px button is the hover-toolbar button: 12 inside the toolbar's 16.
const radiusBySize: Record<IconButtonSize, IconButtonRadius> = {
  20: 'xs',
  22: 'xs',
  26: 'md',
  28: 'xl',
  30: 'lg',
  32: 'lg',
  36: 'lg',
}

// Buttons under 24px get an invisible hit area of 24px around the glyph
// (WCAG 2.5.8): the tab close button and the row Resolve check.
const smallSizes: ReadonlySet<IconButtonSize> = new Set([20, 22])

// One step up from the Lucide sizes: Phosphor glyphs fill less of their box.
const iconBySize: Record<IconButtonSize, IconSize> = {
  20: 12,
  22: 12,
  26: 13,
  28: 18,
  30: 18,
  32: 18,
  36: 20,
}

/**
 * A button that is only an icon. Needs a label. A `pressed` toggle keeps
 * both the outline and the filled icon in the DOM and cross-fades them, so
 * only opacity and transform ever animate.
 */
export function IconButton({
  icon,
  label,
  shortcut,
  size = 30,
  iconSize,
  iconTint,
  iconWeight,
  radius,
  variant = 'ghost',
  tone = 'subtle',
  pressed,
  expanded,
  current = false,
  dimmed = false,
  noTooltip = false,
  type = 'button',
  disabled,
  ...rest
}: IconButtonProps) {
  const px = iconSize ?? iconBySize[size]
  const toggle = pressed !== undefined
  return (
    <button
      type={type}
      aria-label={shortcut === undefined ? label : `${label} ${shortcut}`}
      {...(noTooltip ? {} : tooltip(label, shortcut))}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-current={current ? 'page' : undefined}
      aria-disabled={dimmed || undefined}
      disabled={disabled}
      {...rest}
      {...stylex.props(
        interactive.reset,
        interactive.feedback,
        interactive.press,
        interactive.focusRing,
        styles.base,
        sizeStyles[size],
        smallSizes.has(size) && styles.hitArea,
        radiusStyles[radius ?? radiusBySize[size]],
        variants[variant],
        variant === 'ghost' && tones[tone],
        (pressed === true || expanded === true) && pressedStyles[variant],
        current && styles.current,
        (dimmed || disabled) && interactive.dimmed,
      )}
    >
      {toggle ? (
        <span {...stylex.props(styles.pair)}>
          <span {...stylex.props(styles.layer, styles.outline, pressed && styles.outlineHidden)}>
            {iconWeight === undefined ? <Icon icon={icon} size={px} /> : <Icon icon={icon} size={px} weight={iconWeight} />}
          </span>
          <span {...stylex.props(styles.layer, styles.filled, pressed ? styles.filledShown : styles.filledHidden)}>
            <Icon icon={icon} size={px} weight="fill" />
          </span>
        </span>
      ) : iconTint !== undefined ? (
        <span data-icon-tint={iconTint} {...stylex.props(styles.tint, tintColors[iconTint])}>
          {iconWeight === undefined ? <Icon icon={icon} size={px} /> : <Icon icon={icon} size={px} weight={iconWeight} />}
        </span>
      ) : current ? (
        <Icon icon={icon} size={px} weight="fill" />
      ) : iconWeight === undefined ? (
        <Icon icon={icon} size={px} />
      ) : (
        <Icon icon={icon} size={px} weight={iconWeight} />
      )}
    </button>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    verticalAlign: 'middle',
  },
  // Centred on the button, so it reaches past each edge by the same amount.
  hitArea: {
    position: 'relative',
    '::before': {
      content: '""',
      position: 'absolute',
      top: `calc((100% - ${sizes['--control-24']}) / 2)`,
      right: `calc((100% - ${sizes['--control-24']}) / 2)`,
      bottom: `calc((100% - ${sizes['--control-24']}) / 2)`,
      left: `calc((100% - ${sizes['--control-24']}) / 2)`,
    },
  },
  tint: {
    display: 'inline-flex',
  },
  // The page this button opens is showing: the same fill and colour as an active NavItem.
  current: {
    color: accent['--hl-text'],
    backgroundColor: {
      default: accent['--hl-nav'],
      ':hover': { default: null, [HOVER]: accent['--hl-nav'] },
    },
  },
  pair: {
    display: 'grid',
    placeItems: 'center',
  },
  // Both icons share one grid cell.
  layer: {
    gridArea: '1 / 1',
    display: 'inline-flex',
    transitionProperty: 'opacity, transform',
  },
  outline: {
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
    opacity: 1,
  },
  outlineHidden: {
    opacity: 0,
  },
  filled: {
    transitionTimingFunction: motion['--ease-spring'],
  },
  filledHidden: {
    opacity: 0,
    transform: 'scale(0.8)',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
  },
  // The spring overshoots to --pop-scale on its own; the target is 1.
  filledShown: {
    opacity: 1,
    transform: 'scale(1)',
    transitionDuration: motion['--duration-pop'],
  },
})

const sizeStyles = stylex.create({
  20: { width: sizes['--control-20'], height: sizes['--control-20'] },
  22: { width: sizes['--control-22'], height: sizes['--control-22'] },
  26: { width: sizes['--control-26'], height: sizes['--control-26'] },
  28: { width: sizes['--control-28'], height: sizes['--control-28'] },
  30: { width: sizes['--control-30'], height: sizes['--control-30'] },
  32: { width: sizes['--control-32'], height: sizes['--control-32'] },
  36: { width: sizes['--control-36'], height: sizes['--control-36'] },
})

const radiusStyles = stylex.create({
  xs: { borderRadius: radii['--radius-xs'] },
  sm: { borderRadius: radii['--radius-sm'] },
  md: { borderRadius: radii['--radius-md'] },
  lg: { borderRadius: radii['--radius-lg'] },
  xl: { borderRadius: radii['--radius-xl'] },
  full: { borderRadius: radii['--radius-full'] },
})

const variants = stylex.create({
  // On the island's surface `--surface-hover` is too close to read, so the island's controls take the secondary fills.
  island: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
    },
  },
  ghost: {
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  secondary: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
  primary: {
    color: accent['--hl-fg'],
    backgroundColor: accent['--hl'],
  },
  raised: {
    color: colors['--foreground-subtle'],
    backgroundColor: colors['--surface-default'],
    boxShadow: shadows['--shadow-sm'],
  },
})

const tones = stylex.create({
  default: { color: colors['--foreground-default'] },
  subtle: {
    color: {
      default: colors['--foreground-subtle'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
  },
  muted: {
    color: {
      default: colors['--foreground-muted'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
  },
})

const pressedStyles = stylex.create({
  ghost: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
  secondary: { backgroundColor: colors['--secondary-active'] },
  primary: {},
  raised: {},
  island: {
    backgroundColor: {
      default: colors['--secondary-hover'],
      ':hover': { default: null, [HOVER]: colors['--secondary-active'] },
    },
  },
})
