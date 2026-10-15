/**
 * Every route group the engine serves. Feature tracks add their group here;
 * this file is otherwise edited only by the milestone's integration task.
 */
import { AllTopicsRoutes } from './allTopics'
import { ArtRoutes } from './art'
import { SearchRoutes } from './search'
import { PrefsRoutes } from './prefs'
import { EngineRoutes } from './engine'
import { FilesRoutes } from './files'
import { HomeRoutes } from './home'
import { MessagesRoutes } from './messages'
import { NewChatRoutes } from './newChat'
import { NotificationsRoutes } from './notifications'
import { ReadsRoutes } from './reads'
import { SendRoutes } from './send'
import { SessionRoutes } from './session'
import { TopicsRoutes } from './topics'
import { ViewsRoutes } from './views'

export const AllRoutes = EngineRoutes.merge(SessionRoutes).merge(TopicsRoutes).merge(SearchRoutes).merge(PrefsRoutes).merge(MessagesRoutes).merge(ReadsRoutes).merge(ArtRoutes).merge(NewChatRoutes).merge(SendRoutes).merge(HomeRoutes).merge(AllTopicsRoutes).merge(NotificationsRoutes).merge(ViewsRoutes).merge(FilesRoutes)

export type AllRoutes = typeof AllRoutes
