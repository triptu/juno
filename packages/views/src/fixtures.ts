/**
 * Every view's fixtures, keyed by view name. The gallery imports this as
 * `@juno/views/fixtures` next to `@juno/ui/fixtures`.
 */
import type { FixtureSet } from '@juno/ui'
import AccountMenu from './AccountMenu.fixtures'
import AllTopics from './AllTopics.fixtures'
import ActiveThreads from './ActiveThreads.fixtures'
import AppearanceSettings from './AppearanceSettings.fixtures'
import AppInfoView from './AppInfoView.fixtures'
import AttachmentChips from './AttachmentChips.fixtures'
import AudienceWarning from './AudienceWarning.fixtures'
import ChannelIconPicker from './ChannelIconPicker.fixtures'
import Composer from './Composer.fixtures'
import ComposerSlot from './ComposerSlot.fixtures'
import EmojiPicker from './EmojiPicker.fixtures'
import EngineStatusView, { engineNoticeFixtures } from './EngineStatusView.fixtures'
import Home from './Home.fixtures'
import HoverToolbar from './HoverToolbar.fixtures'
import ImageViewer from './ImageViewer.fixtures'
import Message from './Message.fixtures'
import MessageList from './MessageList.fixtures'
import CommandPalette from './CommandPalette.fixtures'
import NewChat from './NewChat.fixtures'
import NewDivider from './NewDivider.fixtures'
import NewMessagesPill from './NewMessagesPill.fixtures'
import NotificationsPage from './NotificationsPage.fixtures'
import UpdateSettings from './UpdateSettings.fixtures'
import PreferencesPage from './PreferencesPage.fixtures'
import PeekKeySetting from './PeekKeySetting.fixtures'
import PeekView from './PeekView.fixtures'
import Reactions from './Reactions.fixtures'
import SendCheckBar from './SendCheckBar.fixtures'
import SessionView from './SessionView.fixtures'
import SetUpJunoView from './SetUpJunoView.fixtures'
import SignInView from './SignInView.fixtures'
import Shell from './Shell.fixtures'
import Sidebar from './Sidebar.fixtures'
import ThreadLink from './ThreadLink.fixtures'
import TitlebarNav from './TitlebarNav.fixtures'
import TopicHeader from './TopicHeader.fixtures'
import TopicRow from './TopicRow.fixtures'
import TopicView from './TopicView.fixtures'
import Workspace from './Workspace.fixtures'
import WhyPopover from './WhyPopover.fixtures'
import ChatCard, { budgetCard, changeCard, connectCard, proposedScheduleCard, proposedTaskCard, providerCard, questionCard, removeCard, resolveCard, scheduleCard, sendMessageCard, taskCard, topicsCardSet, unknownCardSet } from './juno-chat/cards/ChatCard.fixtures'
import EmptyChat from './juno-chat/EmptyChat.fixtures'
import NoProvider from './juno-chat/NoProvider.fixtures'
import JunoChatList from './juno-chat/JunoChatList.fixtures'
import JunoComposer from './juno-chat/JunoComposer.fixtures'
import JunoHeader from './juno-chat/JunoHeader.fixtures'
import OwnerBubble from './juno-chat/OwnerBubble.fixtures'
import ReactionPicker from './juno-chat/ReactionPicker.fixtures'
import RemoveSheet from './juno-chat/RemoveSheet.fixtures'
import StatusBubble from './juno-chat/StatusBubble.fixtures'
import ActivityPage from './juno-pages/ActivityPage.fixtures'
import BackupSection from './juno-pages/BackupSections.fixtures'
import { moveSheet, phraseSheet, restoreSheet } from './juno-pages/BackupSheets.fixtures'
import ThisMacSection from './juno-pages/ThisMacSection.fixtures'
import ConnectionsPage from './juno-pages/ConnectionsPage.fixtures'
import JunoSettingsPage from './juno-pages/JunoSettingsPage.fixtures'
import MemoryPage from './juno-pages/MemoryPage.fixtures'
import ProviderSection from './juno-pages/ProviderSection.fixtures'
import RemembersPage from './juno-pages/RemembersPage.fixtures'
import ReviewPage from './juno-pages/ReviewPage.fixtures'
import ScheduledPage from './juno-pages/ScheduledPage.fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixtures: Readonly<Record<string, FixtureSet<any>>> = {
  AccountMenu,
  AllTopics,
  ActivityPage,
  ActiveThreads,
  AppearanceSettings,
  AppInfoView,
  AttachmentChips,
  BackupSection,
  ChannelIconPicker,
  BudgetCard: budgetCard,
  ChangeCard: changeCard,
  ChatCard,
  AudienceWarning,
  Composer,
  ComposerSlot,
  ConnectCard: connectCard,
  ConnectionsPage,
  EmojiPicker,
  EngineNotice: engineNoticeFixtures,
  EmptyChat,
  NoProvider,
  EngineStatusView,
  ImageViewer,
  Home,
  HoverToolbar,
  JunoChatList,
  JunoComposer,
  JunoHeader,
  JunoSettingsPage,
  ProviderSection,
  MemoryPage,
  Message,
  MessageList,
  CommandPalette,
  MoveSheet: moveSheet,
  NewChat,
  NewDivider,
  NewMessagesPill,
  SendCheckBar,
  NotificationsPage,
  PeekKeySetting,
  PeekView,
  OwnerBubble,
  PreferencesPage,
  UpdateSettings,
  ProposedScheduleCard: proposedScheduleCard,
  ProposedTaskCard: proposedTaskCard,
  ProviderCard: providerCard,
  QuestionCard: questionCard,
  RecoveryPhraseSheet: phraseSheet,
  ReactionPicker,
  Reactions,
  RemembersPage,
  RemoveCard: removeCard,
  RemoveSheet,
  ResolveCard: resolveCard,
  RestoreSheet: restoreSheet,
  ReviewPage,
  ScheduleCard: scheduleCard,
  ScheduledPage,
  SendMessageCard: sendMessageCard,
  SessionView,
  Shell,
  Sidebar,
  SetUpJunoView,
  SignInView,
  StatusBubble,
  TaskCard: taskCard,
  ThisMacSection,
  ThreadLink,
  TitlebarNav,
  TopicsCard: topicsCardSet,
  TopicHeader,
  TopicRow,
  TopicView,
  UnknownCard: unknownCardSet,
  WhyPopover,
  Workspace,
}
