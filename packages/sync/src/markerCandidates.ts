/** A counts snapshot is not evidence that its corresponding socket events arrived. */
import type { CountEntry, RtmFrame } from '@juno/slack-schema'
import { transaction } from '@juno/store'
import { Clock, Effect } from 'effect'
import { saveRepairMarkers } from './mutationRepair'

type Markers = Pick<CountEntry, 'id' | 'updated' | 'history_invalid'>

export function makeMarkerCandidates() {
  let lastPong = 0
  let blocked = false
  let generation = 0
  const failed = new Set<string>()
  const candidates = new Map<string, { markers: Markers; sampledAt: number }>()
  return {
    pong: (receivedAt: number) => { lastPong = receivedAt },
    drop: () => { generation++; candidates.clear() },
    failed: (frame: RtmFrame) => {
      const channel = 'channel' in frame ? (typeof frame.channel === 'string' ? frame.channel : frame.channel.id)
        : 'item' in frame && 'channel' in frame.item ? frame.item.channel : undefined
      if (channel === undefined) {
        blocked = true
        candidates.clear()
      } else {
        failed.add(channel)
        candidates.delete(channel)
      }
    },
    observe: (entries: ReadonlyArray<CountEntry>) => Effect.gen(function* () {
      if (blocked) return
      const started = generation
      const sampledAt = yield* Clock.currentTimeMillis
      // Pongs pass through the same ordered consumer as applyFrame, after any failed event.
      const confirmed = [...candidates.values()].filter((c) => lastPong > c.sampledAt && !failed.has(c.markers.id))
      yield* transaction(saveRepairMarkers(confirmed.map((c) => c.markers)))
      if (blocked || generation !== started) return
      for (const candidate of confirmed) candidates.delete(candidate.markers.id)
      for (const entry of entries) {
        if (failed.has(entry.id) || (entry.updated === undefined && entry.history_invalid === undefined)) continue
        const previous = candidates.get(entry.id)
        const markers = { ...previous?.markers, id: entry.id,
          ...(entry.updated === undefined ? {} : { updated: entry.updated }),
          ...(entry.history_invalid === undefined ? {} : { history_invalid: entry.history_invalid }) }
        if (previous?.markers.updated !== markers.updated || previous?.markers.history_invalid !== markers.history_invalid) {
          candidates.set(entry.id, { markers, sampledAt })
        }
      }
    }),
  }
}
