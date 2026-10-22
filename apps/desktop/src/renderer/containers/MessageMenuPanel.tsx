/**
 * The message menu in a chunk of its own, loaded when idle after a list
 * paints (`messageMenu.tsx`): the view and its icons, the emoji its grid and
 * picker show, and what a topic's and the Juno chat's rows do.
 */
import { useState } from 'react'
import { emojiCatalog } from '@juno/contract'
import { frequentEmojiAtom, quickReactionsAtom } from '@juno/state'
import { emojiPickerDataAtom, standardEmojiPickerData, warmWorkspaceEmoji } from '@juno/state/emoji'
import { useAtomValue } from '@juno/state/react'
import { MessageMenu } from '@juno/views'
import { gridEmoji } from './gridEmoji'
import type { OpenMessageMenu } from './messageMenu'

export { openChatMenu } from './juno/chatMenu'
export { topicMenu } from './topic/messageMenu'

warmWorkspaceEmoji(emojiCatalog)

interface MessageMenuPanelProps {
  readonly menu: OpenMessageMenu
  readonly onReact: (name: string, unicode: string | undefined, url: string | undefined) => void
  readonly onSelect: (id: string, how: { readonly metaKey: boolean }) => void
  readonly onClose: () => void
}

/** The menu with its eleven emoji and every emoji for More reactions, fixed while it is open. */
export function MessageMenuPanel({ menu, onReact, onSelect, onClose }: MessageMenuPanelProps) {
  const current = useAtomValue(emojiPickerDataAtom(emojiCatalog))
  const quick = useAtomValue(quickReactionsAtom)
  const frequent = useAtomValue(frequentEmojiAtom)
  // The workspace's emoji once they have come; changes take effect on the next open, so cells never move under a click.
  const [snapshot, setSnapshot] = useState(current)
  if (snapshot === undefined && current !== undefined) setSnapshot(current)
  const data = (snapshot ?? current)?.data ?? standardEmojiPickerData
  const [grid] = useState(() => gridEmoji(quick, frequent, data).map((emoji) => ({ ...emoji, selected: menu.chosen?.(emoji) === true })))
  const [recent] = useState(frequent)
  return <MessageMenu anchor={menu.anchor} reactions={grid} items={menu.items} noGrid={menu.noGrid === true} onReact={onReact} emoji={{ data, recent }} onSelect={onSelect} onClose={onClose} />
}
