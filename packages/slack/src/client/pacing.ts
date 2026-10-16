import type { SlackConfigShape } from './config.ts'
import type { Lane } from './queue.ts'

/** The background spacing in force: `backgroundMinIntervalMillis`, when set, replaces every value. */
const backgroundPacingOf = (lanes: SlackConfigShape['lanes']) => {
  const override = lanes.backgroundMinIntervalMillis
  if (override === undefined) return lanes.backgroundPacing
  return { totalMillis: override, methodMillis: override, methods: {} }
}

/** Shared lane budgets and method backoff. Times are milliseconds from the queue's clock. */
export const makePacing = (lanes: SlackConfigShape['lanes'], startedAt: number) => {
  const background = backgroundPacingOf(lanes)
  const refillInterval = lanes.interactiveRefillIntervalMillis ?? 500
  let backgroundNext = 0
  let interactiveTokens = 20
  let interactiveUpdated = startedAt
  const buckets = new Map<string, { next: number; base: number; interval: number; decayAt: number }>()
  const bucketOf = (method: string) => {
    let bucket = buckets.get(method)
    if (bucket === undefined) {
      const base = background.methods[method] ?? background.methodMillis
      bucket = { next: 0, base, interval: base, decayAt: Infinity }
      buckets.set(method, bucket)
    }
    return bucket
  }
  const recover = (bucket: ReturnType<typeof bucketOf>, now: number) => {
    while (now >= bucket.decayAt && bucket.interval > bucket.base) {
      bucket.interval = Math.max(bucket.base, bucket.interval / 2)
      bucket.decayAt += 300_000
    }
  }
  return {
    limited(method: string, now: number, previousPause: number) {
      const bucket = bucketOf(method)
      recover(bucket, now)
      if (previousPause <= now) bucket.interval = Math.min(60_000, bucket.interval * 2)
      bucket.decayAt = now + 300_000
    },
    /** Zero consumes a start now; a positive wait reserves nothing. Recheck after sleeping. */
    admit(lane: Lane, method: string, now: number, pauseEnd: number): number {
      const bucket = lane === 'background' ? bucketOf(method) : undefined
      if (bucket !== undefined) recover(bucket, now)
      if (lane === 'interactive' && refillInterval > 0) {
        interactiveTokens = Math.min(20, interactiveTokens + Math.max(0, now - interactiveUpdated) / refillInterval)
        interactiveUpdated = now
      }
      const laneEnd = lane === 'background' ? backgroundNext
        : lane === 'interactive' && refillInterval > 0 ? now + Math.max(0, 1 - interactiveTokens) * refillInterval : 0
      const until = Math.max(pauseEnd, bucket?.next ?? 0, laneEnd)
      if (until > now) return until - now
      if (bucket !== undefined) {
        bucket.next = now + bucket.interval
        backgroundNext = now + background.totalMillis
      }
      if (lane === 'interactive' && refillInterval > 0) interactiveTokens -= 1
      return 0
    },
  }
}
