/**
 * Every view's fixtures, keyed by view name. The gallery imports this as
 * `@juno/views/fixtures` next to `@juno/ui/fixtures`.
 */
import type { FixtureSet } from '@juno/ui'
import AccountMenu from './AccountMenu.fixtures'
import AllTopics from './AllTopics.fixtures'
import AppearanceSettings from './AppearanceSettings.fixtures'
import AppInfoView from './AppInfoView.fixtures'
import AttachmentCard from './AttachmentCard.fixtures'
import AttachmentChips from './AttachmentChips.fixtures'
import AttachmentNote from './AttachmentNote.fixtures'
import AudienceWarning from './AudienceWarning.fixtures'
import ChannelIconPicker from './ChannelIconPicker.fixtures'
import Composer from './Composer.fixtures'
import ComposerSlot from './ComposerSlot.fixtures'
import EmojiPicker from './EmojiPicker.fixtures'
import EngineStatusView, { engineNoticeFixtures, syncProgressFixtures } from './EngineStatusView.fixtures'
import Home from './Home.fixtures'
import SettledReview from './SettledReview.fixtures'
import AutomatedReview from './AutomatedReview.fixtures'
import ReviewCards from './ReviewCards.fixtures'
import SuggestionReviews from './SuggestionReviews.fixtures'
import HoverToolbar from './HoverToolbar.fixtures'
import MediaViewer from './MediaViewer.fixtures'
import Message from './Message.fixtures'
import MessageList from './MessageList.fixtures'
import CommandPalette from './CommandPalette.fixtures'
import NewDivider from './NewDivider.fixtures'
import NewMessagesPill from './NewMessagesPill.fixtures'
import NotificationsPage from './NotificationsPage.fixtures'
import UpdateSettings from './UpdateSettings.fixtures'
import SettingsPage from './SettingsPage.fixtures'
import TabExpirySetting from './TabExpirySetting.fixtures'
import TopicSwitcher from './TopicSwitcher.fixtures'
import PeekKeySetting from './PeekKeySetting.fixtures'
import QuickReactionsSetting from './QuickReactionsSetting.fixtures'
import PeekView from './PeekView.fixtures'
import Reactions from './Reactions.fixtures'
import ReactorsCard from './ReactorsCard.fixtures'
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
import WelcomeCard from './WelcomeCard.fixtures'
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
import ConnectionToolsSheet from './juno-pages/ConnectionToolsSheet.fixtures'
import JunoPageFrame from './juno-pages/JunoPageFrame.fixtures'
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
  AppearanceSettings,
  AppInfoView,
  AttachmentChips,
  AttachmentNote,
  AttachmentCard,
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
  ConnectionToolsSheet,
  EmojiPicker,
  EngineNotice: engineNoticeFixtures,
  SyncProgress: syncProgressFixtures,
  EmptyChat,
  NoProvider,
  EngineStatusView,
  MediaViewer,
  Home,
  SettledReview,
  AutomatedReview,
  ReviewCards,
  SuggestionReviews,
  HoverToolbar,
  JunoChatList,
  JunoComposer,
  JunoHeader,
  JunoPageFrame,
  JunoSettingsPage,
  ProviderSection,
  MemoryPage,
  Message,
  MessageList,
  CommandPalette,
  MoveSheet: moveSheet,
  NewDivider,
  NewMessagesPill,
  SendCheckBar,
  NotificationsPage,
  TabExpirySetting,
  TopicSwitcher,
  PeekKeySetting,
  QuickReactionsSetting,
  PeekView,
  OwnerBubble,
  SettingsPage,
  UpdateSettings,
  ProposedScheduleCard: proposedScheduleCard,
  ProposedTaskCard: proposedTaskCard,
  ProviderCard: providerCard,
  QuestionCard: questionCard,
  RecoveryPhraseSheet: phraseSheet,
  ReactionPicker,
  Reactions,
  ReactorsCard,
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
  WelcomeCard,
  Workspace,
}
