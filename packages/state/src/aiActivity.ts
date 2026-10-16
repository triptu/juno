/** The AI activity log on Settings › AI activity: every model call, newest first, and today's estimated cost. */
import { aiActivity } from '@juno/contract'
import { liveQuery } from './atoms'

export const aiActivityAtom = liveQuery(aiActivity)(undefined)
