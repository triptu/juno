import { useState } from 'react'
/**
 * The emoji picker for Settings' quick reactions, loaded on its own like
 * `EmojiPickerPanel`, so the catalog is not in the first bundle.
 */
import { emojiCatalog, type QuickReaction } from '@juno/contract'
import { emojiPickerDataAtom, standardEmojiPickerData, warmWorkspaceEmoji } from '@juno/state/emoji'
import { frequentEmojiAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { EmojiPicker } from '@juno/views'

warmWorkspaceEmoji(emojiCatalog)

interface QuickReactionPickerProps {
  /** The quick reactions already chosen: shown as chosen, not picked again. */
  readonly selected: ReadonlyArray<QuickReaction>
  readonly onPick: (reaction: QuickReaction) => void
  readonly onClose: () => void
}

/** The picker for Settings' quick reactions: custom emoji too, and the pick as the toolbar draws it. */
export default function QuickReactionPicker({ selected, onPick, onClose }: QuickReactionPickerProps) {
  const recent = useAtomValue(frequentEmojiAtom)
  const [recentSnapshot, setRecentSnapshot] = useState(recent)
  if (recentSnapshot === undefined && recent !== undefined) setRecentSnapshot(recent)
  const current = useAtomValue(emojiPickerDataAtom(emojiCatalog))
  const [snapshot, setSnapshot] = useState(current)
  if (snapshot === undefined && current !== undefined) setSnapshot(current)
  // Table changes take effect on the next open, so cells never move under a pending click.
  const answer = snapshot ?? current
  const data = answer?.data ?? standardEmojiPickerData
  const pick = (name: string, unicode?: string) => {
    if (unicode !== undefined) return onPick({ name, unicode })
    const own = data.byName.get(name)
    if (own?.url !== undefined) return onPick({ name, unicode: `:${name}:`, url: own.url })
  }
  if (recentSnapshot === undefined) return null
  return <EmojiPicker data={data} recent={recentSnapshot} selected={selected} onPick={pick} onClose={onClose} />
}
