/**
 * Every view's fixtures, keyed by view name. The gallery imports this as
 * `@juno/views/fixtures` next to `@juno/ui/fixtures`.
 */
import type { FixtureSet } from '@juno/ui'
import AccountMenu from './AccountMenu.fixtures'
import ActiveThreads from './ActiveThreads.fixtures'
import AppearanceSettings from './AppearanceSettings.fixtures'
import AppInfoView from './AppInfoView.fixtures'
import ChannelIconPicker from './ChannelIconPicker.fixtures'
import ComposerSlot from './ComposerSlot.fixtures'
import EngineStatusView, { engineNoticeFixtures } from './EngineStatusView.fixtures'
import HoverToolbar from './HoverToolbar.fixtures'
import Message from './Message.fixtures'
import MessageList from './MessageList.fixtures'
import NewDivider from './NewDivider.fixtures'
import NewMessagesPill from './NewMessagesPill.fixtures'
import Reactions from './Reactions.fixtures'
import SessionView from './SessionView.fixtures'
import SignInView from './SignInView.fixtures'
import Shell from './Shell.fixtures'
import Sidebar from './Sidebar.fixtures'
import ThreadLink from './ThreadLink.fixtures'
import TopicHeader from './TopicHeader.fixtures'
import TopicRow from './TopicRow.fixtures'
import TopicView from './TopicView.fixtures'
import Workspace from './Workspace.fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixtures: Readonly<Record<string, FixtureSet<any>>> = {
  AccountMenu,
  ActiveThreads,
  AppearanceSettings,
  AppInfoView,
  ChannelIconPicker,
  ComposerSlot,
  EngineNotice: engineNoticeFixtures,
  EngineStatusView,
  HoverToolbar,
  Message,
  MessageList,
  NewDivider,
  NewMessagesPill,
  Reactions,
  SessionView,
  Shell,
  Sidebar,
  SignInView,
  ThreadLink,
  TopicHeader,
  TopicRow,
  TopicView,
  Workspace,
}
