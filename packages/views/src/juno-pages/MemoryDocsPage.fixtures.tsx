import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import type { MemoryDocsPage as MemoryDocsPageModel } from '@juno/agent-contract'
import { defineFixtures, fixture, scene, Text, TooltipLayer } from '@juno/ui'
import { docs, docsEmpty, NOW, remembers } from './fixtures'
import { MemoryDocsPage, type DocEditing, type MemoryDocsPageProps } from './MemoryDocsPage'
import { PinList } from './PinList'

const noop = () => {}
const pins = <PinList page={remembers} now={NOW} onEditStart={noop} onDraftChange={noop} onSave={noop} onCancel={noop} onRemove={noop} />
const base = { now: NOW, onEditStart: noop, onAddStart: noop, onDraftChange: noop, onSave: noop, onCancel: noop, onDelete: noop, pinned: pins }
const frame = { width: 960, height: 1500, padded: false } as const
const page = (props: Pick<MemoryDocsPageProps, 'page'> & Partial<MemoryDocsPageProps>, shot?: { readonly hover?: string; readonly focus?: string }) =>
  fixture<MemoryDocsPageProps>({ ...base, ...props }, shot === undefined ? undefined : { ...frame, ...shot })

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
        {log.length > 0 ? log.join(' ') : '\u00a0'}
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

/** What Juno remembers (SPEC 13.8): Juno's notes about the owner by doc, with sources, the pins, and the recent changes. */
export default defineFixtures(
  MemoryDocsPage,
  {
    Notes: {
      list: page({ page: docs }),
      editing: page({ page: docs, editing: { _tag: 'edit', id: docs.docs[1]!.entries[1]!.id, draft: 'Priya Raman: manager. 1:1 on Thursdays at 11.' } }),
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
      'editing-long-panel': fixture<MemoryDocsPageProps>({ ...base, page: long, editing: editingLong }, { ...frame, width: 360, height: 900 }),
      'editing-long-wide': fixture<MemoryDocsPageProps>({ ...base, page: long, editing: editingLong }, { ...frame, height: 900 }),
      empty: page({ page: docsEmpty, pinned: <PinList page={{ pins: [], usedBytes: 0, budgetBytes: 4096 }} now={NOW} onEditStart={noop} onDraftChange={noop} onSave={noop} onCancel={noop} onRemove={noop} /> }),
    },
    Behaviour: {
      'edit-keys': scene(() => <EditKeys />, { ...frame, width: 360 }),
    },
  },
  frame,
)

const styles = stylex.create({
  // The frame lays its content out at the start; the page takes the frame's width.
  harness: { width: '100%' },
})
