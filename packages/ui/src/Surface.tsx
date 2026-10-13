import * as stylex from '@stylexjs/stylex'
import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import { accent, colors, radii, shadows, spacing } from '@juno/tokens/tokens.stylex'
import type { LayoutStyles } from './internal/sx'

export type SurfaceKind = 'card' | 'popover' | 'toolbar' | 'group' | 'inset' | 'field' | 'toast'
export type SurfacePadding = 'none' | 'xs' | 'sm' | 'md' | 'lg'
export type SurfaceRadius = 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'card' | 'composer' | 'menu' | 'palette' | 'toast'

export interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'style' | 'className'> {
  readonly kind?: SurfaceKind
  /** none 0, xs 4, sm 6, md 12, lg 14. Default by kind. */
  readonly padding?: SurfacePadding
  /** Default by kind. */
  readonly radius?: SurfaceRadius
  readonly as?: ElementType
  /** Extra StyleX styles from the owner (layout only). */
  readonly sx?: LayoutStyles
  readonly children?: ReactNode
}

const paddingByKind: Record<SurfaceKind, SurfacePadding> = {
  card: 'lg',
  popover: 'sm',
  toolbar: 'none',
  group: 'none',
  inset: 'md',
  field: 'none',
  toast: 'none',
}

const radiusByKind: Record<SurfaceKind, SurfaceRadius> = {
  card: 'card',
  popover: 'menu',
  toolbar: '3xl',
  group: 'card',
  inset: 'lg',
  field: 'composer',
  toast: 'toast',
}

/**
 * Container styles. Cards and floating surfaces use a soft shadow with a
 * transparent border, never a coloured border. Inset is the one with a real
 * border, for a block sitting inside a card. Field is the composer frame: an
 * input border that turns into the focus colour while anything inside has
 * focus.
 */
export function Surface({ kind = 'card', padding, radius, as, sx, children, ...rest }: SurfaceProps) {
  const Tag = as ?? 'div'
  return (
    <Tag
      {...rest}
      {...stylex.props(
        styles.base,
        kinds[kind],
        radii_[radius ?? radiusByKind[kind]],
        paddings[padding ?? paddingByKind[kind]],
        sx,
      )}
    >
      {children}
    </Tag>
  )
}

const styles = stylex.create({
  base: {
    boxSizing: 'border-box',
    minWidth: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
  },
})

const kinds = stylex.create({
  card: {
    backgroundColor: colors['--surface-default'],
    boxShadow: shadows['--card-ring'],
  },
  // Floating kinds sit on the raised surface: the same paper in light, one
  // step lighter than a card in dark, where a shadow alone does not separate
  // a menu from the page.
  popover: {
    backgroundColor: colors['--surface-raised'],
    boxShadow: shadows['--pop-shadow'],
  },
  toolbar: {
    backgroundColor: colors['--surface-raised'],
    boxShadow: shadows['--pop-shadow'],
  },
  group: {
    backgroundColor: colors['--surface-default'],
    boxShadow: shadows['--card-ring'],
    overflow: 'hidden',
  },
  inset: {
    backgroundColor: colors['--background'],
    borderColor: colors['--border-default'],
  },
  field: {
    backgroundColor: colors['--surface-default'],
    borderColor: {
      default: colors['--input-border'],
      ':focus-within': accent['--focus-ring'],
    },
    boxShadow: {
      default: 'none',
      ':focus-within': `0 0 0 1px ${accent['--focus-ring']}`,
    },
  },
  toast: {
    backgroundColor: colors['--foreground-default'],
    color: colors['--background'],
    boxShadow: shadows['--shadow-lg'],
  },
})

const radii_ = stylex.create({
  md: { borderRadius: radii['--radius-md'] },
  lg: { borderRadius: radii['--radius-lg'] },
  xl: { borderRadius: radii['--radius-xl'] },
  '2xl': { borderRadius: radii['--radius-2xl'] },
  '3xl': { borderRadius: radii['--radius-3xl'] },
  card: { borderRadius: radii['--radius-card'] },
  composer: { borderRadius: radii['--radius-composer'] },
  menu: { borderRadius: radii['--radius-menu'] },
  palette: { borderRadius: radii['--radius-palette'] },
  toast: { borderRadius: radii['--radius-toast'] },
})

const paddings = stylex.create({
  none: { padding: 0 },
  xs: { padding: spacing['--space-1'] },
  sm: { padding: spacing['--space-1-5'] },
  md: { padding: spacing['--space-3'] },
  lg: { padding: spacing['--space-3-5'] },
})
