/**
 * Every fixture set the gallery knows about. Add a package here and its
 * fixtures get routes and screenshots. `@juno/views` registers the same way:
 * `import { fixtures as views } from '@juno/views/fixtures'`.
 */
import type { FixtureSet } from '@juno/ui'
import { fixtures as ui } from '@juno/ui/fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFixtureSet = FixtureSet<any>

export const registry: Readonly<Record<string, AnyFixtureSet>> = {
  ...ui,
}

export interface Route {
  readonly component: string
  readonly fixture: string
}

/** Every component/fixture pair, in a stable order. */
export function allRoutes(): ReadonlyArray<Route> {
  return Object.keys(registry)
    .toSorted()
    .flatMap((component) =>
      Object.keys((registry[component] as AnyFixtureSet).fixtures).map((fixture) => ({ component, fixture })),
    )
}
