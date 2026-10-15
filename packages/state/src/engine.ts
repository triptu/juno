/** Atoms for the engine feature. */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { enginePing, engineStatus } from '@juno/contract'
import { command, liveQuery } from './atoms'
import { connectionStateAtom } from './client'

export const engineStatusAtom = liveQuery(engineStatus)(undefined)

export const pingCommand = command(enginePing)

/** How far the first sync has come: conversations read out of all, both absent while it is still listing them. */
export interface SyncProgress {
  readonly done?: number
  readonly total?: number
}

/**
 * The first sync's progress for the sidebar, while it runs: the cold boot
 * of an empty store (the engine marks its phases `first`). Undefined
 * otherwise, so a later catch-up shows nothing.
 */
export const syncProgressAtom = Atom.make((get): SyncProgress | undefined => {
  if (get(connectionStateAtom) !== 'connected') return undefined
  const status = get(engineStatusAtom)
  if (status._tag !== 'Success') return undefined
  const phase = status.value.phase
  if (phase._tag === 'booting' && phase.first === true) return {}
  if (phase._tag === 'catching-up' && phase.first === true) return { done: phase.done, total: phase.total }
  return undefined
})

/** Why the sidebar may be behind Slack. `stopped`: the engine has stopped for good and needs a restart. */
export type SyncNotice = 'offline' | 'rate-limited' | 'stopped'

/** A lost connection that comes back within this long never shows: a short drop is not worth a line. */
export const OFFLINE_GRACE_MILLIS = 5_000

const currentNotice = Atom.make((get): SyncNotice | undefined => {
  if (get(connectionStateAtom) === 'failed') return 'stopped'
  const status = get(engineStatusAtom)
  if (status._tag !== 'Success') return undefined
  switch (status.value.phase._tag) {
    case 'offline':
      return 'offline'
    case 'rate-limited':
      return 'rate-limited'
    default:
      return undefined
  }
})

/**
 * The line under the sidebar's filters, if any: the engine stopped for
 * good, Slack slowing Juno down, or offline once that has lasted
 * `OFFLINE_GRACE_MILLIS`. Nothing while all is well, and nothing for an
 * engine restart in progress, which recovers on its own in a few seconds.
 */
export const syncNoticeAtom = Atom.make((get): SyncNotice | undefined => {
  const notice = get(currentNotice)
  if (notice !== 'offline') return notice
  if (Option.getOrUndefined(get.self<SyncNotice | undefined>()) === 'offline') return 'offline'
  const timer = setTimeout(() => get.setSelf('offline'), OFFLINE_GRACE_MILLIS)
  get.addFinalizer(() => clearTimeout(timer))
  return undefined
})
