import { useDeferredValue, useState } from 'react'
import type { PickConversation } from '@juno/contract'
import { pickConversationsAtom, viewsAtom, type ViewSheetState } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { ViewSheet as ViewSheetView, type ViewIconName, type ViewSheetConversation } from '@juno/views'
import { closeViewSheet, saveView } from './viewActions'

const NONE: ReadonlyArray<PickConversation> = []

/** A picker row as the sheet lists it. Only conversations that exist can join a view. */
function conversationsOf(list: ReadonlyArray<PickConversation>): ReadonlyArray<ViewSheetConversation> {
  return list.flatMap((c) => (c.channelId === undefined ? [] : [{ id: c.channelId, name: c.name, kind: c.kind }]))
}

/**
 * The view sheet's draft (inventory 2.3): it starts from the view being
 * edited, or from the conversation New view… was chosen on, and changes
 * nothing until Save. The search reads the New chat picker's local query,
 * with no debounce (performance rule 12): matches while typing, recent
 * conversations while the field is empty.
 */
export function ViewSheet({ sheet }: { readonly sheet: ViewSheetState }) {
  const editing = useAtomValue(viewsAtom, (views) => (sheet.mode === 'edit' ? views.find((view) => view.id === sheet.id) : undefined))
  const [name, setName] = useState(editing?.name ?? '')
  const [icon, setIcon] = useState<ViewIconName | undefined>(editing?.icon)
  const [keepOutOfAll, setKeepOutOfAll] = useState(editing?.keepOutOfAll ?? false)
  const [chosen, setChosen] = useState<ReadonlyArray<ViewSheetConversation>>(() => {
    const byJuno = new Set(editing?.addedByJuno)
    return (editing?.channels ?? (sheet.mode === 'new' ? sheet.channels : [])).map((c) => ({ id: c.id, name: c.name, kind: c.kind, ...(byJuno.has(c.id) ? { addedByJuno: true } : {}) }))
  })
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const picks = useAtomValue(pickConversationsAtom(deferred))
  const found = picks._tag === 'Success' ? picks.value : undefined
  const results = conversationsOf(found === undefined ? NONE : deferred.trim() === '' ? found.recent : [...found.channels, ...found.people])

  const toggle = (conversation: ViewSheetConversation) =>
    setChosen((current) => (current.some((c) => c.id === conversation.id) ? current.filter((c) => c.id !== conversation.id) : [...current, conversation]))

  const save = () =>
    void saveView({
      ...(editing === undefined ? {} : { id: editing.id }),
      name,
      ...(icon === undefined ? {} : { icon }),
      keepOutOfAll,
      channels: chosen.map((c) => c.id),
    })

  return (
    <ViewSheetView
      mode={sheet.mode}
      name={name}
      icon={icon}
      keepOutOfAll={keepOutOfAll}
      chosen={chosen}
      query={query}
      results={results}
      onNameChange={setName}
      onIconChange={setIcon}
      onKeepOutOfAllChange={setKeepOutOfAll}
      onQueryChange={setQuery}
      onToggle={toggle}
      onSave={save}
      onCancel={closeViewSheet}
    />
  )
}
