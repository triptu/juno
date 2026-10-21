/**
 * Reacting to a Juno bubble or card (SPEC 13.1), with what a topic's
 * messages use: the toolbar's quick reactions and More reactions, which
 * opens the emoji picker in the same place. Both float over the list,
 * outside its rows, so no row's paint containment cuts them.
 */
import { Suspense, useCallback, useEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import type { ChatItem } from '@juno/agent-contract'
import { quickReactionsAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Floating, HoverToolbar, type ReactionTarget } from '@juno/views'
import { EmojiPickerPanel, preloadPicker, usePickerDismiss } from '../emojiPicker'
import { frequentEmoji, noteRecentEmoji } from '../recentEmoji'
import { junoCommands } from './actions'

/** The picker's height and its gap: below the button when this much room is there, else above, else inside the list area over the button. */
const PICKER_ROOM = 368
/** The picker's width and the gap kept from the list's edges: its right edge never comes closer to the left than this. */
const PICKER_WIDTH = 314
const EDGE_GAP = 8

type Picker = {
  readonly target: ReactionTarget
  readonly x: number
  readonly y: number
  readonly placement: 'below-end' | 'above-end'
  /** The emoji picker in place of the quick reactions, after More reactions. */
  readonly full: boolean
}

/** Puts focus on the toolbar's first reaction when it opens, so Enter, the arrows and Esc work at once. */
const focusFirst = (node: HTMLElement | null) => node?.querySelector<HTMLElement>('button')?.focus()

/**
 * The open reactions of a bubble or card. `open` takes the box the toolbar
 * hangs off (the React button, or the bubble for the context menu's React)
 * and places it from the list area's top left, as a topic places its picker.
 */
export function useReactionPicker(items: ReadonlyArray<ChatItem>, scrollRef: RefObject<HTMLElement | null>) {
  const [picker, setPicker] = useState<Picker | undefined>(undefined)
  const quick = useAtomValue(quickReactionsAtom)
  useEffect(preloadPicker, [])
  const close = useCallback(() => setPicker(undefined), [])
  usePickerDismiss(picker !== undefined, close)

  const open = useCallback(
    (target: ReactionTarget, box: DOMRect) => {
      const area = scrollRef.current?.closest('[data-juno-chat-middle]')
      if (area == null) return
      const origin = area.getBoundingClientRect()
      const right = Math.min(Math.max(box.right - origin.left, PICKER_WIDTH + EDGE_GAP), origin.width - EDGE_GAP)
      const top = box.top - origin.top
      const bottom = box.bottom - origin.top
      // Under the button, else over it; where neither has room, as low as the picker still fits in the list area, over the button.
      const place = (y: number, placement: Picker['placement']) => setPicker({ target, x: right, y, placement, full: false })
      if (bottom + PICKER_ROOM <= origin.height) place(bottom, 'below-end')
      else if (top >= PICKER_ROOM) place(top, 'above-end')
      else place(Math.max(0, origin.height - PICKER_ROOM), 'below-end')
    },
    [scrollRef],
  )

  if (picker === undefined) return { open, floating: undefined }

  // Picking the owner's current reaction again removes it (SPEC 13.1).
  const mine = ownReaction(items, picker.target)
  const react = (name: string, unicode: string | undefined) => {
    setPicker(undefined)
    noteRecentEmoji(name)
    const emoji = unicode ?? name
    void junoCommands.react(picker.target, emoji === mine ? null : emoji)
  }
  // Esc closes, and focus goes back to the row's React button.
  const back = () => {
    setPicker(undefined)
    reactButton(scrollRef.current, picker.target)?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    back()
  }
  const reactions = quick

  const floating = (
    <Floating x={picker.x} y={picker.y} placement={picker.placement} layer="picker">
      {picker.full ? (
        <Suspense fallback={null}>
          <EmojiPickerPanel recent={frequentEmoji(reactions)} onPick={react} onClose={back} />
        </Suspense>
      ) : (
        <div ref={focusFirst} data-juno-reactions="" onKeyDown={onKeyDown}>
          <HoverToolbar
            label="Reactions"
            reactions={reactions}
            onReact={(name) => react(name, reactions.find((reaction) => reaction.name === name && reaction.url === undefined)?.unicode)}
            onMoreReactions={() => setPicker({ ...picker, full: true })}
          />
        </div>
      )}
    </Floating>
  )
  return { open, floating }
}

/** The owner's current reaction on a bubble or card. */
function ownReaction(items: ReadonlyArray<ChatItem>, target: ReactionTarget): string | undefined {
  const item = items.find((i) => (target._tag === 'bubble' ? i._tag === 'juno' && i.id === target.id : i._tag === 'card' && i.card.id === target.id))
  const reactions = item?._tag === 'juno' || item?._tag === 'card' ? item.reactions : []
  return reactions.find((reaction) => reaction.by === 'owner')?.emoji
}

function reactButton(scroller: HTMLElement | null, target: ReactionTarget): HTMLElement | null | undefined {
  const row = target._tag === 'bubble' ? `[data-chat-juno="${CSS.escape(target.id)}"]` : `[data-chat-card-row="${CSS.escape(target.id)}"]`
  return scroller?.querySelector<HTMLElement>(`${row} [data-row-actions] button`)
}
