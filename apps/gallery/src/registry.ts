/**
 * Every fixture set the gallery knows about: the ui primitives and the
 * feature views. Add a package here and its fixtures get routes and
 * screenshots.
 */
import type { FixtureFrame, FixtureSet } from '@juno/ui'
import { fixtures as ui } from '@juno/ui/fixtures'
import { fixtures as views } from '@juno/views/fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFixtureSet = FixtureSet<any>

export const registry: Readonly<Record<string, AnyFixtureSet>> = {
  ...ui,
  ...views,
}

export interface Route {
  readonly component: string
  readonly fixture: string
  /** The merged frame, so the screenshot runner knows what to hover, press or focus. */
  readonly frame: FixtureFrame
}

/** Every component/fixture pair, in a stable order. */
export function allRoutes(): ReadonlyArray<Route> {
  return Object.keys(registry)
    .toSorted()
    .flatMap((component) => {
      const set = registry[component] as AnyFixtureSet
      return Object.entries(set.fixtures).map(([fixture, definition]) => ({
        component,
        fixture,
        frame: { ...set.frame, ...definition.frame },
      }))
    })
}
