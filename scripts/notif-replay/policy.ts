/**
 * Auto's last steps with the constants as parameters, for the report's sweeps.
 * It follows `decideNotification` in `packages/domain/src/notificationDecision.ts`;
 * the report checks that with today's constants it decides every message as
 * the replay's real call did.
 */
import { BURST_SECONDS, INSTRUCTION_NOTIFY_CONFIDENCE, INSTRUCTION_STAY_CONFIDENCE, LIVE_MINUTES, NEEDS_YOU_THRESHOLD, type DecidedBy, type Instruction, type NotificationOutcome } from '@juno/domain'
import { needsSum, type ReplayItem } from './model'

export interface Knobs {
  readonly instructionNotify: number
  readonly instructionStay: number
  readonly needsYou: number
  readonly liveMinutes: number
}

export const currentKnobs: Knobs = {
  instructionNotify: INSTRUCTION_NOTIFY_CONFIDENCE,
  instructionStay: INSTRUCTION_STAY_CONFIDENCE,
  needsYou: NEEDS_YOU_THRESHOLD,
  liveMinutes: LIVE_MINUTES,
}

export interface Outcome {
  readonly outcome: NotificationOutcome
  readonly decidedBy: DecidedBy
}

function beforeBurst(item: ReplayItem, knobs: Knobs, instructions: ReadonlyArray<Instruction>): Outcome {
  if (item.early !== undefined) return item.early
  const minutes = item.facts.ownerWroteMinutesAgo
  if (minutes !== undefined && minutes <= knobs.liveMinutes) return { outcome: 'notify', decidedBy: 'live' }
  const reading = item.reading
  if (reading === undefined || reading === 'failed') {
    return { outcome: item.kind === 'dm' || item.kind === 'group DM' || item.mentionsMe ? 'notify' : 'stay', decidedBy: 'timeout' }
  }
  const chosen = instructions.find((entry) => entry.id === reading.instruction?.id)
  if (chosen !== undefined && reading.instruction !== undefined) {
    const enough = chosen.direction === 'notify' ? knobs.instructionNotify : knobs.instructionStay
    if (reading.instruction.confidence >= enough) return { outcome: chosen.direction, decidedBy: 'instruction' }
  }
  return { outcome: needsSum(reading) >= knobs.needsYou ? 'notify' : 'stay', decidedBy: 'reading' }
}

/** Every item's outcome, by id. Items must be in time order: a banner holds its topic quiet for `BURST_SECONDS`. */
export function decideAll(items: ReadonlyArray<ReplayItem>, knobs: Knobs, instructions: ReadonlyArray<Instruction>): Map<string, Outcome> {
  const lastBanner = new Map<string, number>()
  const out = new Map<string, Outcome>()
  for (const item of items) {
    let decided = beforeBurst(item, knobs, instructions)
    if (decided.outcome === 'notify') {
      const last = lastBanner.get(item.topicId)
      if (last !== undefined && (item.at - last) / 1000 < BURST_SECONDS) decided = { outcome: 'stay', decidedBy: 'burst' }
      else lastBanner.set(item.topicId, item.at)
    }
    out.set(item.id, decided)
  }
  return out
}
