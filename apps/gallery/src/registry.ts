/**
 * Every fixture set the gallery knows about: the ui primitives, the
 * feature views, the huddle views and the compositions of views from two
 * packages (compositions.tsx). Add a package here and its states get a link, a switcher
 * entry and a screenshot.
 */
import type { Fixture, FixtureFrame, FixtureSet } from '@juno/ui'
import { fixtures as huddleViews } from '@juno/huddle-views/fixtures'
import { fixtures as ui } from '@juno/ui/fixtures'
import { fixtures as views } from '@juno/views/fixtures'
import { compositions } from './compositions'
import { testFixtures } from './testFixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFixtureSet = FixtureSet<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFixture = Fixture<any>

/** One state of one component, with everything a page or a test needs. */
export interface StateEntry {
  readonly component: string
  /** Heading as declared; empty when the state has no group. */
  readonly group: string
  readonly groupId: string
  readonly key: string
  readonly label: string
  /** The `__state` URL value, unique within the component. */
  readonly id: string
  /** `<component>/<id>`: the frame's `data-fixture-frame` and the screenshot path. */
  readonly route: string
  /** The set frame merged with the state's own. */
  readonly frame: FixtureFrame
  readonly fixture: AnyFixture
}

export interface GroupEntry {
  readonly name: string
  readonly id: string
  readonly states: ReadonlyArray<StateEntry>
}

export interface ComponentEntry {
  readonly name: string
  readonly set: AnyFixtureSet
  readonly groups: ReadonlyArray<GroupEntry>
  /** Every state in display order: the order j and k walk. */
  readonly states: ReadonlyArray<StateEntry>
}

/** `/?test-fixtures#/...` adds the fixtures of the gallery's own tests (testFixtures.tsx). */
const withTestFixtures = new URLSearchParams(window.location.search).has('test-fixtures')

const sets: Readonly<Record<string, AnyFixtureSet>> = { ...ui, ...views, ...huddleViews, ...compositions, ...(withTestFixtures ? testFixtures : {}) }

/** Every component, sorted by name. */
export const components: ReadonlyArray<ComponentEntry> = Object.keys(sets)
  .toSorted()
  .map((name) => {
    const set = sets[name] as AnyFixtureSet
    const groups = set.groups.map((group) => ({
      name: group.name,
      id: group.id,
      states: group.states.map(
        (state): StateEntry => ({
          component: name,
          group: group.name,
          groupId: group.id,
          key: state.key,
          label: state.label,
          id: state.id,
          route: `${name}/${state.id}`,
          frame: { ...set.frame, ...state.fixture.frame },
          fixture: state.fixture,
        }),
      ),
    }))
    return { name, set, groups, states: groups.flatMap((group) => group.states) }
  })

const byName = new Map(components.map((entry) => [entry.name, entry]))

export function findComponent(name: string): ComponentEntry | undefined {
  return byName.get(name)
}

/**
 * The state a `__state` value names. No value means the first state. A bare
 * key (the old `#/Button/primary` links) matches the first state with that key.
 */
export function findState(entry: ComponentEntry, value: string | null): StateEntry | undefined {
  if (value === null || value === '') return entry.states[0]
  return entry.states.find((state) => state.id === value) ?? entry.states.find((state) => state.key === value)
}

/** The shape the screenshot and behaviour runners read from `window.__galleryRoutes`. */
export interface Route {
  readonly component: string
  readonly group: string
  readonly groupId: string
  readonly state: string
  readonly id: string
  readonly route: string
  readonly frame: FixtureFrame
}

export const allRoutes: ReadonlyArray<Route> = components.flatMap((entry) =>
  entry.states.map((state) => ({
    component: state.component,
    group: state.group,
    groupId: state.groupId,
    state: state.key,
    id: state.id,
    route: state.route,
    frame: state.frame,
  })),
)
