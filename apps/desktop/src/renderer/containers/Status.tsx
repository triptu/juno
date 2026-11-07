/**
 * The status sheet's place in the window (SPEC 14, "Your status"): nothing
 * until the avatar menu's status row opens it, then the sheet
 * (`StatusSheet.tsx`, its own chunk) over the window.
 */
import { registry, statusSheetOpenAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { chunk, usePreloaded } from './chunks'

const sheetChunk = chunk(() => import('./StatusSheet'))
const StatusSheet = sheetChunk.component((module) => module.StatusSheet)

const close = () => registry.set(statusSheetOpenAtom, false)

export function Status() {
  const open = useAtomValue(statusSheetOpenAtom)
  const ready = usePreloaded(sheetChunk, open)
  if (!open || !ready) return null
  return <StatusSheet onClose={close} />
}
