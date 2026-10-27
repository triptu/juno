import type { WorkControlOptions } from '../src/workControl'

export type DraftWriteStep = 'claim' | 'absence'

/** A held draft write: `reached` once draft sync waits before it, `release()` to let it write, `written` once it has. */
export interface DraftWriteHold {
  readonly reached: Promise<void>
  readonly release: () => void
  readonly written: Promise<void>
}

const opened = () => {
  let open = () => {}
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open }
}

/** Holds for draft sync's writes (`WorkControlOptions.onDraftWrite`), one per step and topic, each used once. */
export function draftHolds(): { readonly onDraftWrite: NonNullable<WorkControlOptions['onDraftWrite']>; readonly hold: (step: DraftWriteStep, topicId: string) => DraftWriteHold } {
  const holds = new Map<string, { reach: () => void; gate: Promise<void>; write: () => void; held: boolean }>()
  return {
    onDraftWrite: (step, topicId, phase) => {
      const hold = holds.get(`${step}:${topicId}`)
      if (hold === undefined) return undefined
      if (phase === 'before' && !hold.held) {
        hold.held = true
        hold.reach()
        return hold.gate
      }
      if (phase === 'after' && hold.held) {
        holds.delete(`${step}:${topicId}`)
        hold.write()
      }
      return undefined
    },
    hold: (step, topicId) => {
      const reached = opened()
      const gate = opened()
      const written = opened()
      holds.set(`${step}:${topicId}`, { reach: reached.open, gate: gate.promise, write: written.open, held: false })
      return { reached: reached.promise, release: gate.open, written: written.promise }
    },
  }
}
