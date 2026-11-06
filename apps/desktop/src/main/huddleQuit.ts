/**
 * Asks before a quit or a restart to update while the user is in a huddle
 * (SPEC 20, "Quitting"), as a native dialog. The engine says which huddle
 * the user is in or joining (`huddle`). ⌘Q, the menu's Quit and the Dock's
 * Quit all reach `before-quit`; this holds it with `preventDefault` until
 * the user answers, and the other `before-quit` listeners skip a held quit.
 * A confirmed quit starts again and goes on as any other: the engine leaves
 * the huddle as it stops. The answer holds only while the quit it allowed is
 * under way: a Restart that found no update to install leaves the huddle on,
 * and the next ⌘Q asks again. When the engine stops for good the huddle it
 * reported is dropped, since nothing is left to leave. The window's close
 * asks `hidesOnClose`: in a huddle, with no quit under way, it hides instead
 * (`index.ts`). No business logic.
 *
 * Under JUNO_E2E the dialog is recorded, not shown, and answered as the
 * test says (`testHooks`), Quit by default so a test that ends in a huddle
 * still closes.
 */
import { app, dialog, type BrowserWindow } from 'electron'
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

/** Shows the dialog over the app window when it is visible, and answers whether the user confirmed. */
async function ask(asked: QuitDialog, window: BrowserWindow | undefined): Promise<boolean> {
  const options = { type: 'warning' as const, message: asked.title, detail: asked.detail, buttons: [asked.confirm, 'Cancel'], defaultId: 0, cancelId: 1 }
  const { response } = window?.isVisible() === true ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  return response === 0
}

export function createHuddleQuit(e2e: boolean, appWindow: () => BrowserWindow | undefined) {
  let call: Call = null
  /** The user agreed to leave the huddle, and the quit that asked is under way. */
  let quitting = false
  let asking: Promise<boolean> | undefined
  const askedForTests: Array<QuitDialog> = []
  let answerForTests: 'confirm' | 'cancel' = 'confirm'

  /**
   * Runs `go` at once with no huddle, or while an agreed quit is under way. Otherwise asks first; a second
   * ⌘Q while the dialog shows gets the same answer. `go` says whether a quit followed: a Restart with no
   * update ready quits nothing, and the huddle goes on unasked.
   */
  const confirm = (kind: QuitKind, go: () => boolean): Promise<void> => {
    if (call === null || quitting) return Promise.resolve(void go())
    if (asking === undefined) {
      const asked = quitDialog(kind, call)
      if (e2e) askedForTests.push(asked)
      asking = (e2e ? Promise.resolve(answerForTests === 'confirm') : ask(asked, appWindow())).finally(() => {
        asking = undefined
      })
    }
    return asking.then((ok) => {
      if (!ok) return
      quitting = true
      if (!go()) quitting = false
    })
  }

  // Prepended, so it runs before the listeners that stop things.
  app.prependListener('before-quit', (event) => {
    if (call === null || quitting) return
    event.preventDefault()
    void confirm('quit', () => {
      app.quit()
      return true
    })
  })

  return {
    /** Handles `huddle` from the engine. False for anything else. */
    handle(message: EngineToMain): boolean {
      if (message._tag !== 'huddle') return false
      call = message.call
      return true
    },
    /** The engine stopped for good: no huddle is left to ask about. */
    engineFailed(): void {
      call = null
    },
    /** The window hides on close instead of closing: the user is in a huddle and no agreed quit is under way. */
    hidesOnClose: () => call !== null && !quitting,
    confirm,
    testHooks: {
      huddleQuitAsked: () => askedForTests,
      huddleQuitAnswer: (answer: 'confirm' | 'cancel') => {
        answerForTests = answer
      },
    },
  }
}
