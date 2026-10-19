/**
 * The Forward sheet's place in the window (spec section 7, "Forward"):
 * nothing until the message menu's Forward… opens it, then the sheet
 * (`ForwardSheet.tsx`, its own chunk, loaded on idle) over the window.
 */
import { forwardSheetAtom, registry } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { SheetLayer } from '@juno/views'
import { chunk, usePreloaded } from './chunks'

const sheetChunk = chunk(() => import('./ForwardSheet'))
const ForwardSheet = sheetChunk.component((module) => module.ForwardSheet)

const close = () => registry.set(forwardSheetAtom, undefined)

export function Forward() {
  const sheet = useAtomValue(forwardSheetAtom)
  const ready = usePreloaded(sheetChunk, sheet !== undefined)
  if (sheet === undefined || !ready) return null
  return (
    <SheetLayer onClose={close}>
      <ForwardSheet key={sheet.message.id} sheet={sheet} />
    </SheetLayer>
  )
}
