import { useEffect, useState } from 'react'
import { Exit } from 'effect'
import type { MemoryDocsPage as MemoryDocsPageModel, MemoryEntryId, MemoryPerson, MemoryPersonId, PersonRelationship, PinId } from '@juno/agent-contract'
import type { Person } from '@juno/contract'
import { locatePerson, nowAtom, registry } from '@juno/state'
import { docsPageAtom, junoPageActions, memoryPersonAtom, rememberedAtom, remembersPageAtom } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { MemoryDocsPage, PinList, type DocEditing, type PersonFaces } from '@juno/views'

const actions = junoPageActions(registry)

/** Times change at most at a day boundary; re-render for it this often. */
const TIME_STEP = 10 * 60_000
const useNow = () => useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)

/** Slack profiles already looked up, for every visit to the page. */
const known = new Map<string, Person | null>()

/**
 * The avatars of the people with a file, from the engine's store, never
 * Slack. Rows draw their initials first; a photo is drawn over them when it
 * arrives, so nothing moves.
 */
function useFaces(page: MemoryDocsPageModel | undefined): PersonFaces {
  const [faces, setFaces] = useState<PersonFaces>(() => Object.fromEntries([...known].flatMap(([id, face]) => (face === null ? [] : [[id, face]]))))
  const missing = page?.people.filter((file) => !known.has(file.id)).map((file) => file.id) ?? []
  const key = missing.join(',')
  useEffect(() => {
    if (key === '') return
    let live = true
    void Promise.all(
      key.split(',').map(async (id) => {
        const exit = await locatePerson(registry, id)
        known.set(id, Exit.isSuccess(exit) ? (exit.value.person ?? null) : null)
      }),
    ).then(() => {
      if (live) setFaces(Object.fromEntries([...known].flatMap(([id, face]) => (face === null ? [] : [[id, face]]))))
    })
    return () => {
      live = false
    }
  }, [key])
  return faces
}

/**
 * What Juno remembers (SPEC 13.8): Juno's notes about the owner and the
 * person files, live from the agent, with the pins under them. Edit, Add
 * and Delete are the owner's and work in every state; a refused save stays
 * open with the agent's line ("This changed. Check it and save again.").
 * A person's file opens in place of the page (`memoryPersonAtom`), also
 * from "What Juno knows about {name}". Until the first value arrives the
 * page draws nothing (performance 4.4).
 */
export function MemoryDocs() {
  const result = useAtomValue(docsPageAtom)
  // The pins draw in the same frame as the notes, so their section never fills in late.
  const pinsAnswered = useAtomValue(rememberedAtom)._tag !== 'Initial'
  const person = useAtomValue(memoryPersonAtom)
  const now = useNow()
  const [editing, setEditing] = useState<DocEditing | undefined>(undefined)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // A relationship the owner chose shows at once (performance 1), until the agent's page moves past the revision it was chosen on.
  const [chosen, setChosen] = useState<Readonly<Record<string, Chosen>>>({})
  const faces = useFaces(result._tag === 'Success' ? result.value.page : undefined)
  if (result._tag !== 'Success' || !pinsAnswered) return null
  const { revisions } = result.value
  const served = result.value.page
  const pending = Object.entries(chosen).filter(([id, choice]) => served.people.some((file) => file.id === id && file.revision === choice.revision))
  if (pending.length !== Object.keys(chosen).length) setChosen(Object.fromEntries(pending))
  const page = pending.length === 0 ? served : { ...served, people: served.people.map((file) => (file.id in chosen ? withRelationship(file, chosen[file.id]!.relationship) : file)) }
  const revisionOf = (id: MemoryEntryId) => revisions.find((entry) => entry.id === id)?.revision ?? 0
  const textOf = (id: MemoryEntryId) =>
    [...page.docs.flatMap((section) => section.entries), ...page.people.flatMap((file) => file.entries)].find((entry) => entry.id === id)?.text ?? ''
  const save = () => {
    if (editing === undefined) return
    const pending =
      editing._tag === 'add'
        ? actions.addDoc(editing.doc, editing.draft, editing.person === undefined ? undefined : { person: editing.person, section: editing.section ?? 'notes' })
        : actions.editDoc(editing.id, revisionOf(editing.id), editing.draft)
    void pending.then((answer) => {
      if (answer.outcome === 'ok') return setEditing(undefined)
      const error = 'message' in answer ? answer.message : undefined
      setEditing((current) => (current === undefined ? current : { ...current, ...(error === undefined ? {} : { error }) }))
    })
  }
  const show = (id: MemoryPersonId | undefined) => {
    setEditing(undefined)
    setConfirmingDelete(false)
    registry.set(memoryPersonAtom, id)
  }
  return (
    <MemoryDocsPage
      page={page}
      now={now}
      faces={faces}
      {...(editing === undefined ? {} : { editing })}
      {...(person === undefined ? {} : { person })}
      onEditStart={(id) => setEditing({ _tag: 'edit', id, draft: textOf(id) })}
      onAddStart={(doc, file) => setEditing({ _tag: 'add', doc, ...(file === undefined ? {} : { person: file.person, section: file.section }), draft: '' })}
      onDraftChange={(draft) => setEditing((current) => (current === undefined ? current : { ...current, draft }))}
      onSave={save}
      onCancel={() => setEditing(undefined)}
      onDelete={(id) => void actions.deleteDoc(id, revisionOf(id))}
      onOpenPerson={show}
      onClosePerson={() => show(undefined)}
      onRelationship={(id, relationship) => {
        const revision = served.people.find((file) => file.id === id)?.revision ?? 0
        setChosen((current) => ({ ...current, [id]: { relationship, revision } }))
        void actions.relationship(id, revision, relationship).then((answer) => {
          // A refusal puts back what the agent has.
          if (answer.outcome !== 'ok') setChosen((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))
        })
      }}
      confirmingDelete={confirmingDelete}
      onDeleteStart={() => setConfirmingDelete(true)}
      onDeleteCancel={() => setConfirmingDelete(false)}
      onDeleteFile={(id) =>
        void actions.deletePerson(id).then((answer) => {
          if (answer.outcome === 'ok') show(undefined)
        })
      }
      pinned={<Pins now={now} />}
    />
  )
}

interface Chosen {
  readonly relationship: PersonRelationship | null
  readonly revision: number
}

/** A file with the owner's choice of relationship, as the agent will store it. */
function withRelationship(file: MemoryPerson, relationship: PersonRelationship | null): MemoryPerson {
  const { relationship: _was, relationshipBy: _by, ...rest } = file
  return relationship === null ? rest : { ...rest, relationship, relationshipBy: 'owner' }
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
