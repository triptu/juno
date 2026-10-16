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
  /**
   * Before the screenshot, press the first element matching `from` and move
   * the pointer `by` px sideways, holding the button, so a drag shows
   * mid-way. Reduced motion is turned off for the shot.
   */
  readonly drag?: { readonly from: string; readonly by: number }
  /**
   * Before the screenshot, move the pointer over the first element matching
   * this selector and wait for its tooltip (`TooltipLayer` in the fixture),
   * so the shot holds the tooltip whatever the delay.
   */
  readonly tooltip?: string
}

export interface Fixture<P> {
  readonly props: P
  readonly frame?: FixtureFrame
  /** Custom render for a composed scene; `props` is ignored when set. */
  readonly render?: () => ReactNode
}

/** One state of a component, as the gallery lists it. */
export interface FixtureState<P> {
  /** The key as declared, for example `loading`. */
  readonly key: string
  /** The key in sentence case, for example `Loading`. */
  readonly label: string
  /** The `__state` URL value: `<group id>/<key>`, or just `<key>` when ungrouped. */
  readonly id: string
  readonly fixture: Fixture<P>
}

/** States that belong together under a heading in product words. */
export interface FixtureGroup<P> {
  /** The heading as declared, for example `Data`. Empty for states declared without a group. */
  readonly name: string
  /** The heading in kebab-case, for example `data`. Empty when ungrouped. */
  readonly id: string
  readonly states: ReadonlyArray<FixtureState<P>>
}

/**
 * What a fixtures file declares: states grouped under a heading, or (still
 * accepted) a bare state. Bare states are listed first, with no heading.
 */
export type FixtureDeclaration<P> = Readonly<Record<string, Fixture<P> | Readonly<Record<string, Fixture<P>>>>>

export interface FixtureSet<P> {
  readonly component: ComponentType<P>
  readonly groups: ReadonlyArray<FixtureGroup<P>>
  readonly frame?: FixtureFrame
}

const isFixture = <P>(value: Fixture<P> | Readonly<Record<string, Fixture<P>>>): value is Fixture<P> =>
  typeof (value as Fixture<P>).props === 'object' && (value as Fixture<P>).props !== null

/** `Photo failed` and `photo-failed` both become `photo-failed`. */
const slug = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** `photo-failed` becomes `Photo failed`. */
const sentence = (key: string): string => {
  const spaced = key.replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Declares the states the gallery renders for a component, grouped under
 * headings in product words:
 *
 * ```ts
 * defineFixtures(SessionView, {
 *   Account: { ready: fixture({...}), 'signing-out': fixture({...}) },
 *   Failure: { 'sign-out-failed': fixture({...}) },
 * })
 * ```
 *
 * Every primitive and view exports one of these from `<Name>.fixtures.tsx`.
 * The gallery shows one state at a time at `/#/SessionView?__state=account/ready`
 * and screenshots each one. List only states the component's code can reach.
 * A pending state holds still: nothing in a fixture resolves on a timer.
 */
export function defineFixtures<P>(component: ComponentType<P>, declaration: FixtureDeclaration<P>, frame?: FixtureFrame): FixtureSet<P> {
  const bare: FixtureState<P>[] = []
  const groups: FixtureGroup<P>[] = []
  const stateIds = new Set<string>()
  const groupIds = new Set<string>()
  const addState = (id: string, key: string, definition: Fixture<P>): FixtureState<P> => {
    if (id === '' || stateIds.has(id)) throw new Error(`Duplicate or empty fixture state "${id}" for ${component.name}`)
    stateIds.add(id)
    return { key, label: sentence(key), id, fixture: definition }
  }
  for (const [key, entry] of Object.entries(declaration)) {
    if (isFixture(entry)) {
      bare.push(addState(slug(key), key, entry))
      continue
    }
    const id = slug(key)
    if (id === '' || groupIds.has(id)) throw new Error(`Duplicate or empty fixture group "${key}" for ${component.name}`)
    groupIds.add(id)
    groups.push({
      name: key,
      id,
      states: Object.entries(entry).map(([stateKey, definition]) => addState(`${id}/${slug(stateKey)}`, stateKey, definition)),
    })
  }
  return { component, groups: bare.length > 0 ? [{ name: '', id: '', states: bare }, ...groups] : groups, ...(frame ? { frame } : {}) }
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
