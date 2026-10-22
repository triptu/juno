import * as stylex from '@stylexjs/stylex'
import { useRef, type ReactNode, type RefObject } from 'react'
import { useMorph, type MenuState } from './menuMorph'

interface MorphLayersProps {
  /** The menu's root: it takes the panel's box. */
  readonly root: RefObject<HTMLDivElement | null>
  /** The menu's box and side just before: where the morph starts. */
  readonly menu: RefObject<MenuState | undefined>
  /** The box the menu lives in: the window, or the gallery's frame. */
  readonly view: () => { readonly width: number; readonly height: number }
  /** The menu's content, fading out. */
  readonly from: ReactNode
  /** The menu's material and its content's padding, from `ContextMenu`. */
  readonly material: stylex.StyleXStyles
  readonly body: stylex.StyleXStyles
  /** The panel's content, fading in. */
  readonly children: ReactNode
}

/**
 * The context menu as it turns into a panel (`menuMorph.ts`): the material
 * under everything, and a window that clips the old content and the new to
 * the material's box while it grows.
 */
export function MorphLayers({ root, menu, view, from, material, body, children }: MorphLayersProps) {
  const surface = useRef<HTMLDivElement>(null)
  const clip = useRef<HTMLDivElement>(null)
  const fromRef = useRef<HTMLDivElement>(null)
  const to = useRef<HTMLDivElement>(null)
  useMorph(root, menu, view, { surface, window: clip, from: fromRef, to })
  return (
    <>
      <div ref={surface} aria-hidden {...stylex.props(material, styles.surface)} />
      <div ref={clip} {...stylex.props(styles.window)}>
        <div ref={fromRef} inert aria-hidden {...stylex.props(body, styles.from)}>
          {from}
        </div>
        <div ref={to} {...stylex.props(styles.to)}>
          {children}
        </div>
      </div>
    </>
  )
}

const styles = stylex.create({
  // Scaled from the menu's box to the panel's.
  surface: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  },
  // Clips both contents to the surface while it grows, scaled with it. In flow, so the panel's content sets the panel's size.
  window: {
    position: 'relative',
    width: 'max-content',
    overflow: 'hidden',
  },
  // The menu's content, faded out by its animation and kept hidden after.
  from: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
    pointerEvents: 'none',
  },
  // Positioned, so it draws over the menu's content.
  to: {
    position: 'relative',
  },
})
