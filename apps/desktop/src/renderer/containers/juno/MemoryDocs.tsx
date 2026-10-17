import { useState } from 'react'
import type { MemoryEntryId, PinId } from '@juno/agent-contract'
import { nowAtom, registry } from '@juno/state'
import { docsPageAtom, junoPageActions, remembersPageAtom } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { MemoryDocsPage, PinList, type DocEditing } from '@juno/views'

const actions = junoPageActions(registry)

/** Times change at most at a day boundary; re-render for it this often. */
const TIME_STEP = 10 * 60_000
const useNow = () => useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)

/**
 * What Juno remembers (SPEC 13.8): Juno's notes about the owner, live from
 * the agent, with the pins under them. Edit, Add and Delete are the
 * owner's and work in every state; a refused save stays open with the
 * agent's line ("This changed. Check it and save again."). Until the first
 * value arrives the page draws nothing (performance 4.4).
 */
export function MemoryDocs() {
  const result = useAtomValue(docsPageAtom)
  const now = useNow()
  const [editing, setEditing] = useState<DocEditing | undefined>(undefined)
  if (result._tag !== 'Success') return null
  const { page, revisions } = result.value
  const revisionOf = (id: MemoryEntryId) => revisions.find((entry) => entry.id === id)?.revision ?? 0
  const textOf = (id: MemoryEntryId) => page.docs.flatMap((section) => section.entries).find((entry) => entry.id === id)?.text ?? ''
  const save = () => {
    if (editing === undefined) return
    const pending = editing._tag === 'add' ? actions.addDoc(editing.doc, editing.draft) : actions.editDoc(editing.id, revisionOf(editing.id), editing.draft)
    void pending.then((answer) => {
      if (answer.outcome === 'ok') return setEditing(undefined)
      const error = 'message' in answer ? answer.message : undefined
      setEditing((current) => (current === undefined ? current : { ...current, ...(error === undefined ? {} : { error }) }))
    })
  }
  return (
    <MemoryDocsPage
      page={page}
      now={now}
      {...(editing === undefined ? {} : { editing })}
      onEditStart={(id) => setEditing({ _tag: 'edit', id, draft: textOf(id) })}
      onAddStart={(doc) => setEditing({ _tag: 'add', doc, draft: '' })}
      onDraftChange={(draft) => setEditing((current) => (current === undefined ? current : { ...current, draft }))}
      onSave={save}
      onCancel={() => setEditing(undefined)}
      onDelete={(id) => void actions.deleteDoc(id, revisionOf(id))}
      pinned={<Pins now={now} />}
    />
  )
}

/** The pins under the notes, edited as before. */
function Pins({ now }: { readonly now: number }) {
  const result = useAtomValue(remembersPageAtom)
  const [editing, setEditing] = useState<{ readonly id: PinId; readonly draft: string } | undefined>(undefined)
  if (result._tag !== 'Success') return null
  const { page, revisions } = result.value
  const revisionOf = (id: PinId) => revisions.find((entry) => entry.id === id)?.revision ?? 0
  return (
    <PinList
      page={page}
      now={now}
      {...(editing === undefined ? {} : { editing })}
      onEditStart={(id) => setEditing({ id, draft: page.pins.find((pin) => pin.id === id)?.text ?? '' })}
      onDraftChange={(draft) => setEditing((current) => (current === undefined ? current : { ...current, draft }))}
      onSave={() => {
        if (editing === undefined) return
        void actions.editPin(editing.id, revisionOf(editing.id), editing.draft).then((outcome) => {
          // A stale edit stays open: the page marks the pin "This changed. Check it and save again."
          if (outcome === 'ok') setEditing(undefined)
        })
      }}
      onCancel={() => setEditing(undefined)}
      onRemove={(id) => void actions.removePin(id, revisionOf(id))}
    />
  )
}
