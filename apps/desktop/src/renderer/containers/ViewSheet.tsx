import { useDeferredValue, useState } from 'react'
import { BUILTIN_PILL_NAMES, type BuiltinPill, type PickConversation, type ViewColor } from '@juno/contract'
import { pickConversationsAtom, pillLooksAtom, registry, savePillLook, viewsAtom, type ViewSheetState } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { PillSheet as PillSheetView, ViewSheet as ViewSheetView, type ViewIconName, type ViewSheetConversation } from '@juno/views'
import { closeViewSheet, saveView } from './viewActions'

const NONE: ReadonlyArray<PickConversation> = []

/** A picker row as the sheet lists it. Only conversations that exist can join a view. */
function conversationsOf(list: ReadonlyArray<PickConversation>): ReadonlyArray<ViewSheetConversation> {
  return list.flatMap((c) => (c.channelId === undefined ? [] : [{ id: c.channelId, name: c.name, kind: c.kind }]))
}

/**
 * The view sheet's draft (inventory 2.3): it starts from the view being
 * edited, or from the conversation New view… was chosen on, and changes
 * nothing until Save. The search reads the destination list's local query,
 * with no debounce (performance rule 12): matches while typing, recent
 * conversations while the field is empty.
 */
export function ViewSheet({ sheet }: { readonly sheet: ViewSheetState }) {
  return sheet.mode === 'pill' ? <PillSheet id={sheet.id} /> : <ViewDraftSheet sheet={sheet} />
}

/** Edit view on Channels, DMs or Reactions: a draft of the icon and colour, saved to the workspace preference on Save. */
function PillSheet({ id }: { readonly id: BuiltinPill }) {
  const look = useAtomValue(pillLooksAtom)[id]
  const [icon, setIcon] = useState<ViewIconName | undefined>(look.icon)
  const [color, setColor] = useState<ViewColor | undefined>(look.color)
  const save = () => {
    void savePillLook(registry, id, { ...(icon === undefined ? {} : { icon }), ...(color === undefined ? {} : { color }) })
    closeViewSheet()
  }
  return <PillSheetView name={BUILTIN_PILL_NAMES[id]} icon={icon} color={color} onIconChange={setIcon} onColorChange={setColor} onSave={save} onCancel={closeViewSheet} />
}

function ViewDraftSheet({ sheet }: { readonly sheet: Exclude<ViewSheetState, { readonly mode: 'pill' }> }) {
  const editing = useAtomValue(viewsAtom, (views) => (sheet.mode === 'edit' ? views.find((view) => view.id === sheet.id) : undefined))
  const [name, setName] = useState(editing?.name ?? '')
  const [icon, setIcon] = useState<ViewIconName | undefined>(editing?.icon)
  const [color, setColor] = useState<ViewColor | undefined>(editing?.color)
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
      color: color ?? null,
      keepOutOfAll,
      channels: chosen.map((c) => c.id),
    })

  return (
    <ViewSheetView
      mode={sheet.mode}
      name={name}
      icon={icon}
      color={color}
      keepOutOfAll={keepOutOfAll}
      chosen={chosen}
      query={query}
      results={results}
      onNameChange={setName}
      onIconChange={setIcon}
      onColorChange={setColor}
      onKeepOutOfAllChange={setKeepOutOfAll}
      onQueryChange={setQuery}
      onToggle={toggle}
      onSave={save}
      onCancel={closeViewSheet}
    />
  )
}
