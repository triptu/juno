import * as stylex from '@stylexjs/stylex'
import type { ElementType, HTMLAttributes, ReactNode, Ref } from 'react'
import { colors } from '@juno/tokens/tokens.stylex'
import type { LayoutStyles } from './internal/sx'

export type ScrollAreaScrollbar = 'always' | 'hover'

export interface ScrollAreaProps extends Omit<HTMLAttributes<HTMLElement>, 'style' | 'className'> {
  /**
   * `always` draws the thumb whenever there is overflow (the global
   * scrollbar style). `hover` keeps the track and thumb transparent until
   * the pointer is over the area. Default `always`.
   */
  readonly scrollbar?: ScrollAreaScrollbar
  /** The scroll element, for an owner that reads or restores its position. */
  readonly ref?: Ref<HTMLElement>
  readonly as?: ElementType
  /** Extra StyleX styles from the owner (layout only: padding, flex). */
  readonly sx?: LayoutStyles
  readonly children?: ReactNode
}

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

/**
 * A vertical scroll container with contained overscroll, so a wheel at the
 * end never scrolls the page behind. The scrollbar keeps its 10px gutter
 * (`--scrollbar-size`, global.css) in both modes; `hover` changes only the
 * thumb's colour, so showing or hiding it never moves the content. Keyboard
 * and trackpad scrolling are the browser's own.
 */
export function ScrollArea({ scrollbar = 'always', as, sx, children, ...rest }: ScrollAreaProps) {
  const Tag = as ?? 'div'
  return (
    <Tag data-scroll-area={scrollbar} {...rest} {...stylex.props(styles.area, scrollbar === 'hover' && styles.hoverScrollbar, sx)}>
      {children}
    </Tag>
  )
}

const styles = stylex.create({
  area: {
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  // global.css draws the thumb in --scrollbar-thumb, so the pseudo-element
  // follows the area's hover state. Only the colour changes; the gutter is
  // always there. (global.css is unlayered and would win over a
  // ::-webkit-scrollbar-thumb rule written here.)
  hoverScrollbar: {
    '--scrollbar-thumb': {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--border-strong'] },
    },
  },
})
