/**
 * Settings › Appearance › Quick reactions (SPEC 14): the message toolbar's
 * one-click reactions, saved as the `quickReactions` preference in user.db.
 * Add opens the emoji picker with the workspace's custom emoji, from the
 * picker's own chunk.
 */
import { Suspense, useMemo, useState } from 'react'
import { composerEmojiAtom, quickReactionsAtom, registry, setQuickReactions } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { QuickReactionsSetting } from '@juno/views'
import { chunk } from './chunks'
import { frequentEmoji } from './recentEmoji'
import { customEmoji, type QuickReaction } from '@juno/contract'

const pickerChunk = chunk(() => import('./QuickReactionPicker'))
const QuickReactionPicker = pickerChunk.component((module) => module.default)

export function QuickReactions() {
  const saved = useAtomValue(quickReactionsAtom)
  // The list moves on the change; the saved value takes over once it agrees, or if the save fails.
  const [shown, setShown] = useState<ReadonlyArray<QuickReaction> | undefined>(undefined)
  if (shown !== undefined && sameNames(shown, saved)) setShown(undefined)
  const reactions = shown ?? saved
  const [open, setOpen] = useState(false)
  const workspace = useAtomValue(composerEmojiAtom(open))
  const custom = useMemo(() => (workspace._tag === 'Success' ? customEmoji(workspace.value) : []), [workspace])

  const change = (next: ReadonlyArray<QuickReaction>) => {
    setShown(next)
    void setQuickReactions(registry, next).then((exit) => {
      if (exit._tag === 'Failure') setShown(undefined)
    })
  }
  const add = (reaction: QuickReaction) => {
    setOpen(false)
    if (!reactions.some((other) => other.name === reaction.name)) change([...reactions, reaction])
  }

  return (
    <QuickReactionsSetting
      reactions={reactions}
      onChange={change}
      onAdd={() => setOpen((was) => !was)}
      onClosePicker={() => setOpen(false)}
      picker={open ? (
        <Suspense fallback={null}>
          <QuickReactionPicker custom={custom} recent={frequentEmoji([])} onPick={add} onClose={() => setOpen(false)} />
        </Suspense>
      ) : undefined}
    />
  )
}

const sameNames = (a: ReadonlyArray<QuickReaction>, b: ReadonlyArray<QuickReaction>) =>
  a.length === b.length && a.every((reaction, i) => reaction.name === b[i]!.name)
