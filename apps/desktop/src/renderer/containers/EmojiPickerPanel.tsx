/**
 * The emoji picker with the full catalog. Loaded on its own (`emojiPicker.ts`),
 * so the catalog is not in the first bundle; the chunk is fetched when a
 * topic or the Juno chat has painted, before the first open.
 */
import { emojiCatalog } from '@juno/contract'
import { EmojiPicker } from '@juno/views'

export interface EmojiPickerPanelProps {
  readonly recent: ReadonlyArray<string>
  /** The pick's Slack name, and its character for callers that store the emoji itself (the Juno chat). */
  readonly onPick: (name: string, unicode: string | undefined) => void
  readonly onClose: () => void
}

let unicodeByName: Map<string, string> | undefined
const unicodeOf = (name: string) => {
  unicodeByName ??= new Map(emojiCatalog.flatMap((category) => category.emoji.map((emoji) => [emoji.name, emoji.unicode] as const)))
  return unicodeByName.get(name)
}

export default function EmojiPickerPanel({ recent, onPick, onClose }: EmojiPickerPanelProps) {
  return <EmojiPicker catalog={emojiCatalog} recent={recent} onPick={(name) => onPick(name, unicodeOf(name))} onClose={onClose} />
}
