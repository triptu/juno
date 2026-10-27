/**
 * The channel sheet's place in the window (SPEC 5, "Channel sheet"):
 * nothing until New channel… or Edit channel… opens it, then the sheet
 * (`ChannelSheet.tsx`, its own chunk, loaded on idle) over the window.
 */
import { channelSheetAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { SheetLayer } from '@juno/views'
import { closeChannelSheet } from './channelActions'
import { chunk, usePreloaded } from './chunks'

const sheetChunk = chunk(() => import('./ChannelSheet'))
const ChannelSheet = sheetChunk.component((module) => module.ChannelSheet)

export function Channel() {
  const sheet = useAtomValue(channelSheetAtom)
  const ready = usePreloaded(sheetChunk, sheet !== undefined)
  if (sheet === undefined || !ready) return null
  return (
    <SheetLayer onClose={closeChannelSheet}>
      <ChannelSheet key={sheet.mode === 'edit' ? sheet.channelId : 'new'} sheet={sheet} />
    </SheetLayer>
  )
}
