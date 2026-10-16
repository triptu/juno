/**
 * The emoji picker with the full catalog. Loaded on its own (`chunk` in
 * `topic/messageOverlays.tsx`), so the catalog is not in the first bundle; the
 * chunk is fetched when a topic has painted, before the first open.
 */
import { emojiCatalog } from '@juno/contract'
import { EmojiPicker } from '@juno/views'

export interface EmojiPickerPanelProps {
  readonly recent: ReadonlyArray<string>
  readonly onPick: (name: string) => void
  readonly onClose: () => void
}

export default function EmojiPickerPanel({ recent, onPick, onClose }: EmojiPickerPanelProps) {
  return <EmojiPicker catalog={emojiCatalog} recent={recent} onPick={onPick} onClose={onClose} />
}
