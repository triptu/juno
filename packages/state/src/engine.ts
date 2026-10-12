/** Atoms for the engine feature. */
import { enginePing, engineStatus } from '@juno/contract'
import { command, liveQuery } from './atoms'

export const engineStatusAtom = liveQuery(engineStatus)(undefined)

export const pingCommand = command(enginePing)
