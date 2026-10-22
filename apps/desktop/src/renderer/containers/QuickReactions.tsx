/**
 * Settings › Appearance › Quick reactions (SPEC 14): the first emoji of the
 * message menu's grid, saved as the `quickReactions` preference in user.db.
 * Add opens the emoji picker with the workspace's custom emoji, from the
 * picker's own chunk, with the chosen ones marked.
 */
import { useState } from 'react'
import { quickReactionsAtom, registry, setQuickReactions } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { QuickReactionsSetting } from '@juno/views'
import { chunk, usePreloaded } from './chunks'
import type { QuickReaction } from '@juno/contract'

const pickerChunk = chunk(() => import('./QuickReactionPicker'))
const QuickReactionPicker = pickerChunk.component((module) => module.default)

export function QuickReactions() {
  const saved = useAtomValue(quickReactionsAtom)
  // The list moves on the change; the saved value takes over once it agrees, or if the save fails.
  const [shown, setShown] = useState<ReadonlyArray<QuickReaction> | undefined>(undefined)
  if (shown !== undefined && sameNames(shown, saved)) setShown(undefined)
  const reactions = shown ?? saved
  const [open, setOpen] = useState(false)
  const ready = usePreloaded(pickerChunk, open)

  const change = (next: ReadonlyArray<QuickReaction>) => {
    setShown(next)
    void setQuickReactions(registry, next).then((exit) => {
      if (exit._tag === 'Failure') setShown(undefined)
    })
  }
  const add = (reaction: QuickReaction) => {
    setOpen(false)
    if (!reactions.some((other) => other.name === reaction.name && (other.url === undefined) === (reaction.url === undefined))) change([...reactions, reaction])
  }

  return (
    <QuickReactionsSetting
      reactions={reactions}
      onChange={change}
      onAdd={() => setOpen((was) => !was)}
      onClosePicker={() => setOpen(false)}
      picker={open && ready ? (
        <QuickReactionPicker selected={reactions} onPick={add} onClose={() => setOpen(false)} />
      ) : undefined}
    />
  )
}

const sameNames = (a: ReadonlyArray<QuickReaction>, b: ReadonlyArray<QuickReaction>) =>
  a.length === b.length && a.every((reaction, i) => reaction.name === b[i]!.name)
