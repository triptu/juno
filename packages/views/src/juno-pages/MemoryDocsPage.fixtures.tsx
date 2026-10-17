import { defineFixtures, fixture, scene, TooltipLayer } from '@juno/ui'
import { docs, docsEmpty, NOW, remembers } from './fixtures'
import { MemoryDocsPage, type MemoryDocsPageProps } from './MemoryDocsPage'
import { PinList } from './PinList'

const noop = () => {}
const pins = <PinList page={remembers} now={NOW} onEditStart={noop} onDraftChange={noop} onSave={noop} onCancel={noop} onRemove={noop} />
const base = { now: NOW, onEditStart: noop, onAddStart: noop, onDraftChange: noop, onSave: noop, onCancel: noop, onDelete: noop, pinned: pins }
const frame = { width: 960, height: 1500, padded: false } as const
const page = (props: Pick<MemoryDocsPageProps, 'page'> & Partial<MemoryDocsPageProps>, shot?: { readonly hover?: string; readonly focus?: string }) =>
  fixture<MemoryDocsPageProps>({ ...base, ...props }, shot === undefined ? undefined : { ...frame, ...shot })

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
      empty: page({ page: docsEmpty, pinned: <PinList page={{ pins: [], usedBytes: 0, budgetBytes: 4096 }} now={NOW} onEditStart={noop} onDraftChange={noop} onSave={noop} onCancel={noop} onRemove={noop} /> }),
    },
  },
  frame,
)
