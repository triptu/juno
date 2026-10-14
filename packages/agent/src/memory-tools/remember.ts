/**
 * The `remember` tool (plan v3 §4.4, §9 Tier 1, G3). The model names exact
 * words from one of the owner's messages in this reply; the trusted side
 * finds the message among those admitted in this run and copies the bytes
 * (`pins/rememberQuote`). The model never names a message id or offsets, so
 * it cannot pin text from a report, a tool result or an older run.
 *
 * The pin id is derived from pi's call id, so a call pi replays after a
 * crash finds the pin it wrote and adds nothing.
 */
import { limits, type Pin } from '@juno/agent-memory'
import { rememberQuote } from '../pins/pins'
import { defineTool, type JunoTool } from '../request/tool'
import type { Store } from '../store/store'

export interface MemoryToolContext {
  readonly store: Store
  /** The live run and the archive length once projection has caught up, or undefined between runs. */
  readonly current: () => Promise<{ readonly runId: string; readonly h: number; readonly cutoff: number } | undefined>
  /** A pin was written in `runId`: the chat shows "Remembered · Undo". */
  readonly remembered: (runId: string, pin: Pin) => void
}

const refusals = {
  source: "Nothing was remembered: only words from the owner's own messages in this conversation turn can be remembered.",
  span: `Nothing was remembered: the quote must be exact words from one of the owner's messages in this turn, at most ${limits.pin} bytes.`,
  conflict: 'Nothing was remembered: that pin changed meanwhile.',
  budget: 'Nothing was remembered: the remembered notes are full. Ask the owner which one to drop.',
} as const

export function rememberTool(context: MemoryToolContext): JunoTool {
  return defineTool<{ readonly quote: string }>({
    name: 'remember',
    description:
      'Remember exact words the owner wrote in this conversation turn, so they are kept in every later request. ' +
      `Quote them exactly as written, at most ${limits.pin} bytes. Use it when the owner asks you to remember something.`,
    parameters: {
      type: 'object',
      properties: { quote: { type: 'string', description: "The exact words from the owner's message." } },
      required: ['quote'],
      additionalProperties: false,
    },
    replay: 'safe',
    status: () => 'Remembering',
    run: async ({ quote }, call) => {
      const run = await context.current()
      if (run === undefined) return { text: refusals.source, isError: true }
      const result = rememberQuote(context.store, { id: `pin-${call.callId}`, quote, h: run.h, cutoff: run.cutoff })
      if (result._tag === 'refused') return { text: refusals[result.reason], isError: true }
      context.remembered(run.runId, result.pin)
      return { text: `Remembered: "${result.pin.text}"` }
    },
  })
}
