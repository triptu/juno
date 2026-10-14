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
import ChatCard, { budgetCard, changeCard, connectCard, proposedScheduleCard, proposedTaskCard, providerCard, questionCard, removeCard, resolveCard, scheduleCard, sendMessageCard, taskCard, topicsCardSet, unknownCardSet } from './juno-chat/cards/ChatCard.fixtures'
import EmptyChat from './juno-chat/EmptyChat.fixtures'
import JunoChatList from './juno-chat/JunoChatList.fixtures'
import JunoComposer from './juno-chat/JunoComposer.fixtures'
import JunoHeader from './juno-chat/JunoHeader.fixtures'
import OwnerBubble from './juno-chat/OwnerBubble.fixtures'
import ReactionPicker from './juno-chat/ReactionPicker.fixtures'
import RemoveSheet from './juno-chat/RemoveSheet.fixtures'
import StatusBubble from './juno-chat/StatusBubble.fixtures'
import ActivityPage from './juno-pages/ActivityPage.fixtures'
import ConnectionsPage from './juno-pages/ConnectionsPage.fixtures'
import JunoSettingsPage from './juno-pages/JunoSettingsPage.fixtures'
import MemoryPage from './juno-pages/MemoryPage.fixtures'
import RemembersPage from './juno-pages/RemembersPage.fixtures'
import ReviewPage from './juno-pages/ReviewPage.fixtures'
import ScheduledPage from './juno-pages/ScheduledPage.fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixtures: Readonly<Record<string, FixtureSet<any>>> = {
  AccountMenu,
  ActivityPage,
  ActiveThreads,
  AppearanceSettings,
  AppInfoView,
  ChannelIconPicker,
  BudgetCard: budgetCard,
  ChangeCard: changeCard,
  ChatCard,
  ComposerSlot,
  ConnectCard: connectCard,
  ConnectionsPage,
  EngineNotice: engineNoticeFixtures,
  EmptyChat,
  EngineStatusView,
  HoverToolbar,
  JunoChatList,
  JunoComposer,
  JunoHeader,
  JunoSettingsPage,
  MemoryPage,
  Message,
  MessageList,
  NewDivider,
  NewMessagesPill,
  OwnerBubble,
  ProposedScheduleCard: proposedScheduleCard,
  ProposedTaskCard: proposedTaskCard,
  ProviderCard: providerCard,
  QuestionCard: questionCard,
  ReactionPicker,
  Reactions,
  RemembersPage,
  RemoveCard: removeCard,
  RemoveSheet,
  ResolveCard: resolveCard,
  ReviewPage,
  ScheduleCard: scheduleCard,
  ScheduledPage,
  SendMessageCard: sendMessageCard,
  SessionView,
  Shell,
  Sidebar,
  SignInView,
  StatusBubble,
  TaskCard: taskCard,
  ThreadLink,
  TopicsCard: topicsCardSet,
  TopicHeader,
  TopicRow,
  TopicView,
  UnknownCard: unknownCardSet,
  Workspace,
}
