/**
 * Every route group the engine serves. Feature tracks add their group here;
 * this file is otherwise edited only by the milestone's integration task.
 */
import { SearchRoutes } from './search'
import { PrefsRoutes } from './prefs'
import { EngineRoutes } from './engine'
import { MessagesRoutes } from './messages'
import { SessionRoutes } from './session'
import { TopicsRoutes } from './topics'

export const AllRoutes = EngineRoutes.merge(SessionRoutes).merge(TopicsRoutes).merge(SearchRoutes).merge(PrefsRoutes).merge(MessagesRoutes)

export type AllRoutes = typeof AllRoutes
