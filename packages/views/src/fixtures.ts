/**
 * Every view's fixtures, keyed by view name. The gallery imports this as
 * `@juno/views/fixtures` next to `@juno/ui/fixtures`.
 */
import type { FixtureSet } from '@juno/ui'
import AppInfoView from './AppInfoView.fixtures'
import Shell from './Shell.fixtures'
import ThemeToggleView from './ThemeToggleView.fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixtures: Readonly<Record<string, FixtureSet<any>>> = {
  AppInfoView,
  Shell,
  ThemeToggleView,
}
