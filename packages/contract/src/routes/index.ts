/**
 * Every route group the engine serves. Feature tracks add their group here;
 * this file is otherwise edited only by the milestone's integration task.
 */
import { EngineRoutes } from './engine'

export const AllRoutes = EngineRoutes

export type AllRoutes = typeof AllRoutes
