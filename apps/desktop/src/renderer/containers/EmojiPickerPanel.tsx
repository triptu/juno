import { useState } from 'react'
/**
 * The emoji picker with the full catalog. Loaded on its own (`emojiPicker.ts`),
 * so the catalog is not in the first bundle; the chunk is fetched when a
 * topic or the Juno chat has painted, before the first open.
 */
import { emojiCatalog } from '@juno/contract'
import { emojiPickerDataAtom, standardEmojiPickerData, warmWorkspaceEmoji } from '@juno/state/emoji'
import { frequentEmojiAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { EmojiPicker } from '@juno/views'

warmWorkspaceEmoji(emojiCatalog)

export interface EmojiPickerPanelProps {
  readonly onPick: (name: string, unicode: string | undefined) => void
  readonly onClose: () => void
}

export default function EmojiPickerPanel({ onPick, onClose }: EmojiPickerPanelProps) {
  const recent = useAtomValue(frequentEmojiAtom)
  const current = useAtomValue(emojiPickerDataAtom(emojiCatalog))
  const [snapshot, setSnapshot] = useState(current)
  if (snapshot === undefined && current !== undefined) setSnapshot(current)
  // Table changes take effect on the next open, so cells never move under a pending click.
  const answer = snapshot ?? current
  return <EmojiPicker data={answer?.data ?? standardEmojiPickerData} recent={recent} onPick={onPick} onClose={onClose} />
}
