import { compareTs, maxTs } from '@juno/domain'
import { Context, Layer } from 'effect'

const keyOf = (channel: string, threadTs: string): string => `${channel}:${threadTs}`

export interface FollowFenceService {
  /** The newest accepted page observation, including the durable value. */
  readonly effective: (channel: string, threadTs: string, durable: string | undefined) => string | undefined
  /** Records a page observation in this workspace session. False when no session fence was provided. */
  readonly advance: (channel: string, threadTs: string, observedAt: string) => boolean
  readonly forget: (channel: string, threadTs: string) => void
}

const unavailable: FollowFenceService = {
  effective: (_channel, _threadTs, durable) => durable,
  advance: () => false,
  forget: () => {},
}

/**
 * The in-process half of the follow observation fence. The engine provides one
 * per open workspace; the default keeps standalone writer tests on the durable
 * fence.
 */
export const FollowFence = Context.Reference<FollowFenceService>('juno/sync/FollowFence', {
  defaultValue: () => unavailable,
})

export const followFenceLayer: Layer.Layer<never> = Layer.sync(FollowFence, () => {
  const observations = new Map<string, string>()
  return {
    effective: (channel, threadTs, durable) => {
      const memory = observations.get(keyOf(channel, threadTs))
      if (memory === undefined) return durable
      if (durable === undefined) return memory
      return maxTs(durable, memory)
    },
    advance: (channel, threadTs, observedAt) => {
      const key = keyOf(channel, threadTs)
      const current = observations.get(key)
      if (current === undefined || compareTs(observedAt, current) > 0) observations.set(key, observedAt)
      return true
    },
    forget: (channel, threadTs) => observations.delete(keyOf(channel, threadTs)),
  }
})
