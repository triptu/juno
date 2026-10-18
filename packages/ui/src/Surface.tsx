import * as stylex from '@stylexjs/stylex'
import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import { accent, colors, layout, radii, shadows, sizes, spacing } from '@juno/tokens/tokens.stylex'
import type { LayoutStyles } from './internal/sx'

export type SurfaceKind = 'card' | 'peek' | 'popover' | 'toolbar' | 'group' | 'inset' | 'field' | 'toast' | 'island'
export type SurfacePadding = 'none' | 'xs' | 'sm' | 'md' | 'lg'
export type SurfaceRadius = 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'card' | 'composer' | 'menu' | 'palette' | 'toast' | 'pill'

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
  peek: 'none',
  toolbar: 'none',
  group: 'none',
  inset: 'md',
  field: 'none',
  toast: 'none',
  island: 'none',
}

const radiusByKind: Record<SurfaceKind, SurfaceRadius> = {
  card: 'card',
  popover: 'menu',
  peek: 'menu',
  toolbar: '3xl',
  group: 'card',
  inset: 'lg',
  field: 'composer',
  toast: 'toast',
  island: 'pill',
}

/**
 * Container styles. Cards and floating surfaces use a soft shadow with a
 * transparent border, never a coloured border. Inset is the one with a real
 * border, for a block sitting inside a card. Field is the composer frame: an
 * input border that turns into the focus colour while anything inside has
 * focus. Island is a page header's control group: solid, the card ring,
 * pill-shaped, one 28px control tall with an even inset around it.
 */
export function Surface({ kind = 'card', padding, radius, as, sx, children, ...rest }: SurfaceProps) {
  const Tag = as ?? 'div'
  return (
    <Tag
      {...rest}
      {...stylex.props(
        styles.base,
        radii_[radius ?? radiusByKind[kind]],
        paddings[padding ?? paddingByKind[kind]],
        // After the padding, so the island's own inset wins over `none`.
        kinds[kind],
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
  peek: {
    backgroundColor: colors['--peek-surface'],
    boxShadow: shadows['--peek-shadow'],
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
  },
  toast: {
    backgroundColor: colors['--foreground-default'],
    color: colors['--background'],
    boxShadow: shadows['--shadow-lg'],
  },
  // The inset is what the 36px island leaves around a 28px control inside
  // its 1px transparent border: 3px.
  island: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    height: layout['--header-island-height'],
    paddingBlock: 0,
    paddingInline: `calc((${layout['--header-island-height']} - ${sizes['--control-28']}) / 2 - 1px)`, // tokens-allow: Subtract the 1px surface border from the inset.
    backgroundColor: colors['--surface-default'],
    boxShadow: shadows['--card-ring'],
    pointerEvents: 'auto',
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
  pill: { borderRadius: radii['--radius-pill'] },
})

const paddings = stylex.create({
  none: { padding: 0 },
  xs: { padding: spacing['--space-1'] },
  sm: { padding: spacing['--space-1-5'] },
  md: { padding: spacing['--space-3'] },
  lg: { padding: spacing['--space-3-5'] },
})
