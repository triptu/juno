import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import type { MemoryDocsPage as MemoryDocsPageModel, MemoryPersonId } from '@juno/agent-contract'
import { defineFixtures, fixture, scene, Text, TooltipLayer, type Fixture } from '@juno/ui'
import { docsEmpty, docsWithPeople as docs, faces, NOW, remembers } from './fixtures'
import { MemoryDocsPage, type DocEditing, type MemoryDocsPageProps } from './MemoryDocsPage'
import { PinList } from './PinList'
import { PrivacyOn } from '../fixtures/privacy'

const noop = () => {}
const pins = <PinList page={remembers} now={NOW} onEditStart={noop} onDraftChange={noop} onSave={noop} onCancel={noop} onRemove={noop} />
const base = {
  now: NOW, faces, onEditStart: noop, onAddStart: noop, onDraftChange: noop, onSave: noop, onCancel: noop, onDelete: noop, pinned: pins,
  onOpenPerson: noop, onClosePerson: noop, onRelationship: noop, onDeleteStart: noop, onDeleteCancel: noop, onDeleteFile: noop,
}
const frame = { width: 960, height: 1500, padded: false } as const
const panel = { ...frame, width: 360 } as const
const page = (props: Pick<MemoryDocsPageProps, 'page'> & Partial<MemoryDocsPageProps>, shot?: { readonly hover?: string; readonly focus?: string; readonly width?: number; readonly height?: number }) =>
  fixture<MemoryDocsPageProps>({ ...base, ...props }, shot === undefined ? undefined : { ...frame, ...shot })

const MAYA = 'U0MAYA' as MemoryPersonId
const SAM = 'U0SAM' as MemoryPersonId
const maya = docs.people[0]!
const mayaTalk = maya.entries.find((entry) => entry.section === 'talk')!

/** A note longer than one line of the field, at the panel's width and wide. */
const LONG = 'Maya Chen: owns the Postgres 16 migration plan and the cutover runbook; you suggested her as lead for the backfill tooling; reviews each other\'s backfill PRs, usually the same day, and prefers a short summary of the risk at the top.'
const long: MemoryDocsPageModel = { ...docs, docs: docs.docs.map((section) => (section.doc === 'people' ? { ...section, entries: section.entries.map((entry, index) => (index === 0 ? { ...entry, text: LONG } : entry)) } : section)) }
const editingLong: DocEditing = { _tag: 'edit', id: long.docs[1]!.entries[0]!.id, draft: LONG }

/**
 * The notes with Edit, Save and Cancel live, logging each save and cancel,
 * for the gallery's behaviour spec. Editing grows the row in place.
 */
function EditKeys() {
  const [model, setModel] = useState(long)
  const [editing, setEditing] = useState<DocEditing | undefined>(undefined)
  const [log, setLog] = useState<ReadonlyArray<string>>([])
  const textOf = (id: string) => model.docs.flatMap((section) => section.entries).find((entry) => entry.id === id)?.text ?? ''
  const save = () => {
    if (editing?._tag !== 'edit') return
    const { id, draft } = editing
    setModel((current) => ({ ...current, docs: current.docs.map((section) => ({ ...section, entries: section.entries.map((entry) => (entry.id === id ? { ...entry, text: draft.trim() } : entry)) })) }))
    setEditing(undefined)
    setLog((prev) => [...prev, 'save'])
  }
  return (
    <div data-expands-in-place="" {...stylex.props(styles.harness)}>
      <Text variant="meta" tone="muted" numeric as="p" data-activation-log>
        {/* A non-breaking space keeps the line, so the first log entry moves nothing. */}
        {log.length > 0 ? log.join(' ') : ' '}
      </Text>
      <MemoryDocsPage
        {...base}
        page={model}
        {...(editing === undefined ? {} : { editing })}
        onEditStart={(id) => setEditing({ _tag: 'edit', id, draft: textOf(id) })}
        onDraftChange={(draft) => setEditing((current) => (current === undefined ? current : { ...current, draft }))}
        onSave={save}
        onCancel={() => {
          setEditing(undefined)
          setLog((prev) => [...prev, 'cancel'])
        }}
      />
    </div>
  )
}

/** People with rows that open a file, Back, and the relationship menu live, for trying it in the gallery. */
function People() {
  const [model, setModel] = useState(docs)
  const [open, setOpen] = useState<MemoryPersonId | undefined>(undefined)
  return (
    <div {...stylex.props(styles.harness)}>
      <MemoryDocsPage
        {...base}
        page={model}
        {...(open === undefined ? {} : { person: open })}
        onOpenPerson={setOpen}
        onClosePerson={() => setOpen(undefined)}
        onRelationship={(id, relationship) =>
          setModel((current) => ({
            ...current,
            people: current.people.map((file) => {
              if (file.id !== id) return file
              const { relationship: _was, relationshipBy: _by, ...rest } = file
              return relationship === null ? rest : { ...rest, relationship, relationshipBy: 'owner' as const }
            }),
          }))
        }
      />
    </div>
  )
}

const privately = (props: Partial<MemoryDocsPageProps>, shot: { readonly width: number; readonly height: number }): Fixture<MemoryDocsPageProps> =>
  scene(
    () => (
      <PrivacyOn>
        <MemoryDocsPage {...base} page={docs} {...props} />
      </PrivacyOn>
    ),
    { ...frame, ...shot },
  )

/** What Juno remembers (SPEC 13.8): Juno's notes about the owner by doc, with sources, the person files, the pins, and the recent changes. */
export default defineFixtures(
  MemoryDocsPage,
  {
    Notes: {
      list: page({ page: docs }),
      editing: page({ page: docs, editing: { _tag: 'edit', id: docs.docs[1]!.entries[1]!.id, draft: 'Design reviews are on Wednesdays at 15:00 with the whole product team.' } }),
      adding: page({ page: docs, editing: { _tag: 'add', doc: 'preferences', draft: 'Never schedule anything before 10' } }),
      refused: page({ page: docs, editing: { _tag: 'add', doc: 'preferences', draft: 'my api key is sk-test-0000', error: 'That looks like a key or a password. Juno never keeps those.' } }),
      // Edit and Delete show only on the row the pointer is on, or that holds focus.
      'row-hover': page({ page: docs }, { hover: '[data-memory-entry="e4"]' }),
      'row-focus': page({ page: docs }, { focus: '[data-memory-entry="e4"] button' }),
      // A note from outside content says so in its source's tooltip.
      'outside-tooltip': scene(
        () => (
          <>
            <MemoryDocsPage {...base} page={docs} />
            <TooltipLayer />
          </>
        ),
        { ...frame, tooltip: '[data-memory-entry="e4"] [data-memory-outside]' },
      ),
      // A long note opens at its full height, wrapped, in the panel and in a tab.
      'editing-long-panel': fixture<MemoryDocsPageProps>({ ...base, page: long, editing: editingLong }, { ...panel, height: 900 }),
      'editing-long-wide': fixture<MemoryDocsPageProps>({ ...base, page: long, editing: editingLong }, { ...frame, height: 900 }),
      empty: page({ page: docsEmpty, pinned: <PinList page={{ pins: [], usedBytes: 0, budgetBytes: 4096 }} now={NOW} onEditStart={noop} onDraftChange={noop} onSave={noop} onCancel={noop} onRemove={noop} /> }),
    },
    // People as rows, and a person's file in place of the page, in the panel (360) and in a tab.
    People: {
      'rows-panel': page({ page: docs }, { width: 360, height: 1100 }),
      'rows-wide': page({ page: docs }, { height: 1100 }),
      'row-hover': page({ page: docs }, { width: 360, height: 700, hover: '[data-memory-person="U0MAYA"]' }),
      'file-panel': page({ page: docs, person: MAYA }, { width: 360, height: 1000 }),
      'file-wide': page({ page: docs, person: MAYA }, { height: 1000 }),
      'file-note-hover': page({ page: docs, person: MAYA }, { width: 360, height: 1000, hover: `[data-memory-entry="${mayaTalk.id}"]` }),
      'file-editing-panel': page({ page: docs, person: MAYA, editing: { _tag: 'edit', id: mayaTalk.id, draft: mayaTalk.text } }, { width: 360, height: 1000 }),
      'file-adding-wide': page({ page: docs, person: MAYA, editing: { _tag: 'add', doc: 'people', person: MAYA, section: 'notes', draft: 'Back from leave on the 3rd' } }, { height: 1000 }),
      // Juno has no guess yet: the menu says "Set relationship", and empty sections say "Nothing yet."
      'file-new-panel': page({ page: docs, person: SAM }, { width: 360, height: 800 }),
      'delete-confirm-panel': page({ page: docs, person: MAYA, confirmingDelete: true }, { width: 360, height: 1000 }),
      'delete-confirm-wide': page({ page: docs, person: MAYA, confirmingDelete: true }, { height: 1000 }),
      'relationship-tooltip': scene(
        () => (
          <>
            <MemoryDocsPage {...base} page={docs} person={MAYA} />
            <TooltipLayer />
          </>
        ),
        { ...frame, height: 700, tooltip: 'select[aria-label="Who they are to you"]' },
      ),
      // Privacy mode blurs each row's line of work and every note in a file; names and chips stay readable.
      'privacy-rows-panel': privately({}, { width: 360, height: 1100 }),
      'privacy-file-panel': privately({ person: MAYA }, { width: 360, height: 1000 }),
      'privacy-file-wide': privately({ person: MAYA }, { width: 960, height: 1000 }),
      'none-yet': page({ page: { ...docs, people: [] } }, { width: 360, height: 900 }),
    },
    Behaviour: {
      'edit-keys': scene(() => <EditKeys />, { ...frame, width: 360 }),
      people: scene(() => <People />, panel),
    },
  },
  frame,
)

const styles = stylex.create({
  // The frame lays its content out at the start; the page takes the frame's width.
  harness: { width: '100%' },
})
