/**
 * The context menu (`../ContextMenu.tsx`) turning into a larger panel, the
 * emoji picker: the one place in the app where a surface changes shape in
 * motion (docs/performance.md, "The menu's morph").
 *
 * The panel is laid out at once at its final size, placed so that one
 * corner of the menu stays where it was (`placeMorph`). Then, over
 * `--duration-morph` on `--ease-morph`, Web Animations play it back from the
 * menu's box: the material (`surface`) and a clipping `window` scale from the
 * menu's box to the panel's about that corner, and both contents inside the
 * window are scaled back by the inverse about the same corner, so text never
 * stretches, nothing on screen slides, and nothing shows past the surface's
 * edge. The menu's content fades out and the panel's fades in. Only
 * `transform` and `opacity` move, on the compositor. An inverse scale is not
 * linear in time, so the curve is sampled into keyframes rather than left to
 * the browser's easing. The surface's corners and shadow are scaled back too,
 * so they keep their size; that one box is painted each frame, with no layout.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { rootDuration } from '../motion'
import { placeMorph, type Box, type MenuSide, type Pin } from './menuPlacement'

export interface MorphParts {
  /** The material, under everything. */
  readonly surface: RefObject<HTMLDivElement | null>
  /** Clips both contents to the surface's box as it grows. */
  readonly window: RefObject<HTMLDivElement | null>
  /** The menu's content, kept at the menu's size to fade out. */
  readonly from: RefObject<HTMLDivElement | null>
  /** The panel's content, in flow: it sets the panel's size. */
  readonly to: RefObject<HTMLDivElement | null>
}

/** Where the menu was and which way it opened, recorded while it is a menu. */
export interface MenuState {
  readonly box: Box
  readonly side: MenuSide
}

/**
 * The menu's content fades out over the first 35% of the morph, the panel's in
 * from 15% to 60%: the curve has the surface near its final size by then, and
 * the overlap keeps the two from ever both looking faint.
 */
const FADE_OUT = [{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }]
const FADE_IN = [{ opacity: 0 }, { opacity: 0, offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 1 }]

/** Keyframes per morph: one every 10ms at 240ms, finer than a 120Hz frame needs. */
const SAMPLES = 24

/** The pinned corner as a `transform-origin`. */
const originOf = (pin: Pin) => `${pin.x === 'left' ? '0' : '100%'} ${pin.y === 'top' ? '0' : '100%'}`

/**
 * When the panel mounts, places it before it paints, from the menu's last
 * box, and plays the morph from that box. `view` is the box the menu lives
 * in: the window, or the gallery's frame. `atOnce` shows the panel in its
 * place with no motion, as reduced motion does: a menu opened as the panel.
 */
export function useMorph(root: RefObject<HTMLDivElement | null>, menu: RefObject<MenuState | undefined>, view: () => { readonly width: number; readonly height: number }, parts: MorphParts, atOnce = false): void {
  const { surface: surfaceRef, window: windowRef, from: fromRef, to: toRef } = parts
  useLayoutEffect(() => {
    const [node, surface, clip, from, to, start] = [root.current, surfaceRef.current, windowRef.current, fromRef.current, toRef.current, menu.current]
    if (node === null || surface === null || clip === null || from === null || to === null || start === undefined) return
    const width = node.offsetWidth
    const height = node.offsetHeight
    const edge = Number.parseFloat(getComputedStyle(node).getPropertyValue('--menu-edge')) || 0
    const { x, y, pin } = placeMorph(start.box, { width, height }, start.side, view(), edge)
    node.style.left = `${x}px`
    node.style.top = `${y}px`

    // The menu's content stays on its pixels, held at the pinned corner.
    from.style.width = `${start.box.width}px`
    from.style.height = `${start.box.height}px`
    if (pin.x === 'right') from.style.left = 'auto'
    if (pin.x === 'right') from.style.right = '0'
    if (pin.y === 'bottom') from.style.top = 'auto'
    if (pin.y === 'bottom') from.style.bottom = '0'
    const origin = originOf(pin)
    for (const layer of [surface, clip, from, to]) layer.style.transformOrigin = origin

    const duration = rootDuration('--duration-morph')
    // Reduced motion, or a menu opened as the panel: it shows at once.
    if (duration < 1 || atOnce) return
    const ease = cubicBezier(getComputedStyle(document.documentElement).getPropertyValue('--ease-morph'))
    // How far the pinned corner is from where it was: nothing, unless the view was too small for the panel.
    const dx = pin.x === 'left' ? start.box.x - x : start.box.x + start.box.width - (x + width)
    const dy = pin.y === 'top' ? start.box.y - y : start.box.y + start.box.height - (y + height)
    const sx0 = start.box.width / width
    const sy0 = start.box.height / height
    const look = getComputedStyle(surface)
    const radius = Number.parseFloat(look.borderTopLeftRadius) || 0
    const outer: Keyframe[] = []
    const inner: Keyframe[] = []
    const corners: Keyframe[] = []
    for (let i = 0; i <= SAMPLES; i++) {
      const offset = i / SAMPLES
      const p = ease(offset)
      const sx = sx0 + (1 - sx0) * p
      const sy = sy0 + (1 - sy0) * p
      outer.push({ offset, transform: `translate(${dx * (1 - p)}px, ${dy * (1 - p)}px) scale(${sx}, ${sy})` })
      inner.push({ offset, transform: `scale(${1 / sx}, ${1 / sy})` })
      // Scaled back, so the corners and the shadow look as the menu's did at the start and as the panel's at the end.
      corners.push({ offset, borderRadius: `${radius / sx}px / ${radius / sy}px`, boxShadow: unscaleShadow(look.boxShadow, sx, sy) })
    }
    const timing = { duration, easing: 'linear' }
    const animations = [
      surface.animate(outer, timing),
      surface.animate(corners, timing),
      clip.animate(outer, timing),
      from.animate(inner, timing),
      to.animate(inner, timing),
      from.animate(FADE_OUT, { duration }),
      to.animate(FADE_IN, { duration }),
    ]
    return () => animations.forEach((animation) => animation.cancel())
    // Runs once, when the panel mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Records the menu's box and side while it is a menu, after placement; its rows can change while it is open. */
export function useMenuState(root: RefObject<HTMLDivElement | null>, morphing: boolean): RefObject<MenuState | undefined> {
  const state = useRef<MenuState | undefined>(undefined)
  useLayoutEffect(() => {
    const node = root.current
    if (node === null || morphing) return
    const side = node.dataset['menuSide'] === 'left' ? 'left' : 'right'
    state.current = { side, box: { x: Number.parseFloat(node.style.left) || 0, y: Number.parseFloat(node.style.top) || 0, width: node.offsetWidth, height: node.offsetHeight } }
  })
  return state
}

/** One coordinate of a cubic Bézier from (0, 0) to (1, 1) with control points `a` and `b`, at `u`. */
const bezierAt = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3

/** A `cubic-bezier(x1, y1, x2, y2)` curve as a function of time; anything else falls back to an ease-out. */
export function cubicBezier(css: string): (t: number) => number {
  const numbers = /cubic-bezier\(([^)]*)\)/.exec(css)?.[1]?.split(',').map(Number)
  const [x1, y1, x2, y2] = numbers?.length === 4 && numbers.every(Number.isFinite) ? numbers : [0, 0, 0.58, 1]
  return (t) => {
    if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1
    // x(u) rises with u, so bisect for the u where x(u) = t.
    let low = 0
    let high = 1
    for (let i = 0; i < 30; i++) {
      const mid = (low + high) / 2
      if (bezierAt(x1!, x2!, mid) < t) low = mid
      else high = mid
    }
    return bezierAt(y1!, y2!, (low + high) / 2)
  }
}

/**
 * A computed `box-shadow` list drawn on a box scaled by `sx` × `sy`, so that
 * once scaled it looks as `shadow` does unscaled: offsets divided per axis,
 * blur and spread by the mean scale (a blur has one radius).
 */
export function unscaleShadow(shadow: string, sx: number, sy: number): string {
  if (shadow === 'none' || shadow === '') return shadow
  const mean = (sx + sy) / 2
  return shadow
    .split(/,(?![^(]*\))/)
    .map((one) => {
      let n = 0
      return one.replace(/(-?[\d.]+)px/g, (_, value: string) => {
        const divisor = n === 0 ? sx : n === 1 ? sy : mean
        n += 1
        return `${Number.parseFloat(value) / divisor}px`
      })
    })
    .join(',')
}
