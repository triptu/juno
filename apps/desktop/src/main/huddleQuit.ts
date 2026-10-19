/**
 * Asks before a quit or a restart to update while the user is in a huddle
 * (SPEC 20, "Quitting"), as a native dialog. The engine says which huddle
 * the user is in or joining (`huddle`). A confirmed quit goes on as any
 * other, and the engine leaves the huddle as it stops. No business logic.
 */
import type { EngineToMain } from '@juno/contract'

type Call = Extract<EngineToMain, { _tag: 'huddle' }>['call']

export type QuitKind = 'quit' | 'restart'

export interface QuitDialog {
  readonly title: string
  readonly detail: string
  /** The confirming button; the other is Cancel. */
  readonly confirm: string
}

export function quitDialog(kind: QuitKind, call: NonNullable<Call>): QuitDialog {
  const where = call.place === null ? '' : call.direct ? ` with ${call.place}` : ` in ${call.place}`
  return {
    title: kind === 'quit' ? 'Leave the huddle and quit?' : 'Leave the huddle and restart?',
    detail: `You're in a huddle${where}.`,
    confirm: kind === 'quit' ? 'Quit' : 'Restart',
  }
}

/** `ask` shows the dialog and answers whether the user confirmed. */
export function createHuddleQuit(ask: (dialog: QuitDialog) => Promise<boolean>) {
  let call: Call = null
  let confirmed = false
  let asking: Promise<boolean> | undefined
  return {
    /** Handles `huddle` from the engine. False for anything else. */
    handle(message: EngineToMain): boolean {
      if (message._tag !== 'huddle') return false
      call = message.call
      return true
    },
    /** A quit must wait for `confirm`: the user is in a huddle and has not confirmed. */
    held: (): boolean => call !== null && !confirmed,
    /** True at once with no huddle. Otherwise asks; a second ⌘Q while the dialog shows gets the same answer. */
    confirm(kind: QuitKind): Promise<boolean> {
      if (call === null || confirmed) return Promise.resolve(true)
      asking ??= ask(quitDialog(kind, call)).then((ok) => {
        asking = undefined
        confirmed = ok
        return ok
      })
      return asking
    },
  }
}
