/**
 * What a run looks like to the chat (plan v3 §8, §13.2; `agent-contract`
 * `JunoBubbleItem`, `StatusItem`, `NoteItem`). The chat is not a transcript:
 * only what the model marks for the owner shows.
 *
 * - `started`: the status bubble appears with typing dots.
 * - `bubble`: the model closed a `<say>` block. The bubble shows whole and
 *   the dots go back below it while the run goes on. `replyTo` is the owner
 *   op it answers.
 * - `status`: the run called a tool. The status bubble shows a line that
 *   names real things until the next bubble.
 * - `reaction`: a reaction was set or removed (`emoji: null`), by the owner
 *   on a bubble or card, or by Juno on an owner message.
 * - `steered`: input that arrived while the run was busy was handed to pi,
 *   which places it at the run's next step.
 * - `remembered`: a pin was written ("Remembered · Undo").
 * - `ended`: the run settled with its ending; the status bubble clears.
 */
import type { Ending } from '@juno/agent-contract'

export type Origin = 'owner' | 'wake' | 'report' | 'click'

export type TurnEvent =
  | { readonly _tag: 'started'; readonly runId: string; readonly opId: string; readonly origin: Origin }
  | { readonly _tag: 'bubble'; readonly runId: string; readonly id: string; readonly text: string; readonly replyTo?: string }
  | { readonly _tag: 'status'; readonly runId: string; readonly text: string }
  | {
      readonly _tag: 'reaction'
      readonly target: { readonly kind: 'bubble' | 'card' | 'owner'; readonly id: string }
      readonly by: 'owner' | 'juno'
      readonly emoji: string | null
    }
  | { readonly _tag: 'steered'; readonly runId: string; readonly opId: string }
  | { readonly _tag: 'remembered'; readonly runId: string; readonly pinId: string; readonly version: number; readonly text: string }
  | { readonly _tag: 'ended'; readonly runId: string; readonly opId: string; readonly ending: Ending }

/** The live run, for a renderer that attaches mid-run. */
export interface RunState {
  readonly runId: string
  readonly opId: string
  readonly origin: Origin
  /** The bubbles so far. */
  readonly bubbles: ReadonlyArray<{ readonly id: string; readonly text: string; readonly replyTo?: string }>
  /** The status bubble below them: `{}` shows dots; `{ text }` shows a tool's line. */
  readonly status: { readonly text?: string }
}
