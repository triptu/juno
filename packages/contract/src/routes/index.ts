/**
 * Every route group the engine serves. Feature tracks add their group here;
 * this file is otherwise edited only by the milestone's integration task.
 */
import { AgentWritesRoutes } from './agentWrites'
import { AiRoutes } from './ai'
import { DevLogRoutes } from './devLog'
import { AllTopicsRoutes } from './allTopics'
import { ChannelsRoutes } from './channels'
import { ArtRoutes } from './art'
import { SearchRoutes } from './search'
import { PrefsRoutes } from './prefs'
import { EngineRoutes } from './engine'
import { FilesRoutes } from './files'
import { HomeRoutes } from './home'
import { HuddleRoutes } from './huddle'
import { MembershipRoutes } from './membership'
import { MentionsRoutes } from './mentions'
import { MessagesRoutes } from './messages'
import { NewChatRoutes } from './newChat'
import { NotificationsRoutes } from './notifications'
import { PicturesRoutes } from './pictures'
import { PresenceRoutes } from './presence'
import { ReadsRoutes } from './reads'
import { SendRoutes } from './send'
import { SessionRoutes } from './session'
import { StatusRoutes } from './status'
import { TopicsRoutes } from './topics'
import { ViewsRoutes } from './views'
import { WhoReactedRoutes } from './whoReacted'

export const AllRoutes = EngineRoutes.merge(SessionRoutes).merge(TopicsRoutes).merge(SearchRoutes).merge(PrefsRoutes).merge(MessagesRoutes).merge(ReadsRoutes).merge(ArtRoutes).merge(NewChatRoutes).merge(SendRoutes).merge(HomeRoutes).merge(AllTopicsRoutes).merge(NotificationsRoutes).merge(ViewsRoutes).merge(FilesRoutes).merge(MentionsRoutes).merge(AiRoutes).merge(AgentWritesRoutes).merge(HuddleRoutes).merge(DevLogRoutes).merge(PicturesRoutes).merge(PresenceRoutes).merge(WhoReactedRoutes).merge(ChannelsRoutes).merge(MembershipRoutes).merge(StatusRoutes)

export type AllRoutes = typeof AllRoutes
