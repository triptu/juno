/**
 * Every huddle view's fixtures, keyed by view name. The gallery imports this
 * as `@juno/huddle-views/fixtures` next to the ui and views fixtures.
 */
import type { FixtureSet } from '@juno/ui'
import HuddleBar from './HuddleBar.fixtures'
import HuddleDeviceMenu from './HuddleDeviceMenu.fixtures'
import HuddleHeaderButton from './HuddleHeaderButton.fixtures'
import HuddleIndicator from './HuddleIndicator.fixtures'
import HuddlePage from './HuddlePage.fixtures'
import ScreenSourcePicker from './ScreenSourcePicker.fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixtures: Readonly<Record<string, FixtureSet<any>>> = {
  HuddleBar,
  HuddleDeviceMenu,
  HuddleHeaderButton,
  HuddleIndicator,
  HuddlePage,
  ScreenSourcePicker,
}
