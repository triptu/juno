import type { ComponentType, ReactNode } from 'react'

/** How the gallery frames a fixture. */
export interface FixtureFrame {
  /** Fixed frame width in px. Default: shrink to content. */
  readonly width?: number
  /** Fixed frame height in px. Default: shrink to content. */
  readonly height?: number
  /** Surface behind the component. Default `background`. */
  readonly surface?: 'background' | 'subtle' | 'surface'
  /** Padding around the component. Default true. */
  readonly padded?: boolean
  /**
   * Before the screenshot, move the pointer over the first element matching
   * this selector so the `:hover` styles show.
   */
  readonly hover?: string
  /**
   * Before the screenshot, press and hold the primary button on the first
   * element matching this selector so the `:active` styles (press scale)
   * show. Reduced motion is turned off for the shot.
   */
  readonly press?: string
  /**
   * Before the screenshot, focus the first element matching this selector
   * from the keyboard, so the focus ring and `:focus-within` styles show.
   */
  readonly focus?: string
}

export interface Fixture<P> {
  readonly props: P
  readonly frame?: FixtureFrame
  /** Custom render for a composed scene; `props` is ignored when set. */
  readonly render?: () => ReactNode
}

export interface FixtureSet<P> {
  readonly component: ComponentType<P>
  readonly fixtures: Readonly<Record<string, Fixture<P>>>
  readonly frame?: FixtureFrame
}

/**
 * Declares the named prop sets the gallery renders for a component. Every
 * primitive and view exports one of these from `<Name>.fixtures.tsx`; the
 * gallery turns each key into a route (`/#/Button/primary`) and a screenshot.
 */
export function defineFixtures<P>(
  component: ComponentType<P>,
  fixtures: Readonly<Record<string, Fixture<P>>>,
  frame?: FixtureFrame,
): FixtureSet<P> {
  return { component, fixtures, ...(frame ? { frame } : {}) }
}

/** Shorthand for a fixture that is just props. */
export function fixture<P>(props: P, frame?: FixtureFrame): Fixture<P> {
  return frame ? { props, frame } : { props }
}

/** A fixture that renders a composed scene instead of one prop set. */
export function scene<P>(render: () => ReactNode, frame?: FixtureFrame): Fixture<P> {
  const props = {} as P
  return frame ? { props, frame, render } : { props, render }
}
