/**
 * Every route group the engine serves. Feature tracks add their group here;
 * this file is otherwise edited only by the milestone's integration task.
 */
import { EngineRoutes } from './engine'
import { SessionRoutes } from './session'

export const AllRoutes = EngineRoutes.merge(SessionRoutes)

export type AllRoutes = typeof AllRoutes
