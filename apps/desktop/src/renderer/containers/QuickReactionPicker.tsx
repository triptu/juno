/**
 * The emoji picker for Settings' quick reactions, loaded on its own like
 * `EmojiPickerPanel`, so the catalog is not in the first bundle.
 */
import { emojiCatalog, type QuickReaction } from '@juno/contract'
import { EmojiPicker, type EmojiPickerProps } from '@juno/views'

interface QuickReactionPickerProps {
  readonly custom: NonNullable<EmojiPickerProps['custom']>
  readonly recent: ReadonlyArray<string>
  /** The quick reactions already chosen: shown as chosen, not picked again. */
  readonly selected: ReadonlySet<string>
  readonly onPick: (reaction: QuickReaction) => void
  readonly onClose: () => void
}

/** The picker for Settings' quick reactions: custom emoji too, and the pick as the toolbar draws it. */
export default function QuickReactionPicker({ custom, recent, selected, onPick, onClose }: QuickReactionPickerProps) {
  const pick = (name: string) => {
    const own = custom.find((emoji) => emoji.name === name)
    if (own !== undefined) return onPick({ name, unicode: `:${name}:`, url: own.url })
    for (const category of emojiCatalog) {
      const emoji = category.emoji.find((item) => item.name === name)
      if (emoji !== undefined) return onPick({ name, unicode: emoji.unicode })
    }
  }
  return <EmojiPicker catalog={emojiCatalog} custom={custom} recent={recent} selected={selected} onPick={pick} onClose={onClose} />
}
