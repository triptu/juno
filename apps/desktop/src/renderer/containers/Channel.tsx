/**
 * The channel sheet's place in the window (SPEC 5, "Channel sheet"):
 * nothing until New channel… or Edit channel… opens it, then the sheet
 * (`ChannelSheet.tsx`, its own chunk, loaded on idle) over the window.
 */
import { channelSheetAtom, registry } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { SheetLayer } from '@juno/views'
import { chunk, usePreloaded } from './chunks'

const sheetChunk = chunk(() => import('./ChannelSheet'))
const ChannelSheet = sheetChunk.component((module) => module.ChannelSheet)

// Closes as `channelActions.closeChannelSheet` does; importing that module here would put it in the first screen's bundle.
const close = () => registry.set(channelSheetAtom, undefined)

export function Channel() {
  const sheet = useAtomValue(channelSheetAtom)
  const ready = usePreloaded(sheetChunk, sheet !== undefined)
  if (sheet === undefined || !ready) return null
  return (
    <SheetLayer onClose={close}>
      <ChannelSheet key={sheet.mode === 'edit' ? sheet.channelId : 'new'} sheet={sheet} />
    </SheetLayer>
  )
}
