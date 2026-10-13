/**
 * Every view's fixtures, keyed by view name. The gallery imports this as
 * `@juno/views/fixtures` next to `@juno/ui/fixtures`.
 */
import type { FixtureSet } from '@juno/ui'
import AppearanceSettings from './AppearanceSettings.fixtures'
import AppInfoView from './AppInfoView.fixtures'
import ChannelIconPicker from './ChannelIconPicker.fixtures'
import EngineStatusView from './EngineStatusView.fixtures'
import SessionView from './SessionView.fixtures'
import SignInView from './SignInView.fixtures'
import Shell from './Shell.fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixtures: Readonly<Record<string, FixtureSet<any>>> = {
  AppearanceSettings,
  AppInfoView,
  ChannelIconPicker,
  EngineStatusView,
  SessionView,
  Shell,
  SignInView,
}
