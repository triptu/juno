/**
 * Leave channel… on a private channel asks once, in the pill Delete… uses
 * (SPEC 5): "Leave #eng? You'll need an invite to come back." with Cancel and
 * Leave, where the channel's menu opened. Enter leaves; Esc, Cancel or a
 * press outside keeps the channel.
 */
import { useEffect } from 'react'
import { leaveConfirmAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { chunk, usePreloaded } from './chunks'

// The question and the leave are their own chunk, loaded on idle: most sessions never leave a private channel.
const questionChunk = chunk(() => import('./leaveQuestion'))
const Question = questionChunk.component((module) => module.LeaveQuestion)

/** Where the pointer last pressed: a native menu opens there, so the question shows where the menu was. */
let point = { x: 0, y: 0 }

/** Where the last menu opened, as near as the renderer knows. */
export const lastMenuPoint = (): { readonly x: number; readonly y: number } => point

/** Mounted with the window: follows the pointer's presses, and draws the question while one waits. */
export function LeaveConfirmHost() {
  const asking = useAtomValue(leaveConfirmAtom)
  const ready = usePreloaded(questionChunk, asking !== undefined)
  useEffect(() => {
    const press = (event: MouseEvent) => {
      point = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('mousedown', press, true)
    window.addEventListener('contextmenu', press, true)
    return () => {
      window.removeEventListener('mousedown', press, true)
      window.removeEventListener('contextmenu', press, true)
    }
  }, [])
  return asking === undefined || !ready ? null : <Question key={asking.channel.id} asking={asking} />
}
