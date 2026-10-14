/**
 * What a run looks like to the chat (plan v3 §8, §13.2; `agent-contract`
 * `JunoMessageItem`, `StatusItem`, `NoteItem`). The container turns these
 * into items: one Juno bubble per run, and the status bubble only while the
 * run is live.
 *
 * - `started`: the status bubble appears with dots.
 * - `text`: Juno's text so far, across every request of the run. The first
 *   one replaces the status bubble in place.
 * - `status`: the run called a tool. The status bubble shows below the
 *   text with a line that counts real things, changing at most every 2 s.
 *   The next `text` clears it.
 * - `steered`: input that arrived while the run was busy was handed to pi,
 *   which places it at the run's next step. The owner's bubble shows no
 *   extra state for it; Juno's reply acknowledges it.
 * - `remembered`: a pin was written ("Remembered · Undo").
 * - `ended`: the run settled with its ending; the status bubble clears.
 */
import type { Ending } from '@juno/agent-contract'

export type Origin = 'owner' | 'wake' | 'report' | 'click'

export type TurnEvent =
  | { readonly _tag: 'started'; readonly runId: string; readonly opId: string; readonly origin: Origin }
  | { readonly _tag: 'text'; readonly runId: string; readonly text: string }
  | { readonly _tag: 'status'; readonly runId: string; readonly text: string }
  | { readonly _tag: 'steered'; readonly runId: string; readonly opId: string }
  | { readonly _tag: 'remembered'; readonly runId: string; readonly pinId: string; readonly version: number; readonly text: string }
  | { readonly _tag: 'ended'; readonly runId: string; readonly opId: string; readonly ending: Ending }

/** The live run, for a renderer that attaches mid-run. */
export interface RunState {
  readonly runId: string
  readonly opId: string
  readonly origin: Origin
  /** Juno's text so far. */
  readonly text: string
  /** The status bubble: `undefined` while text streams; `{}` shows dots; `{ text }` shows a line. */
  readonly status: { readonly text?: string } | undefined
}
