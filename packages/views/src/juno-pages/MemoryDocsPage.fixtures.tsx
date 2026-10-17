import { defineFixtures, fixture } from '@juno/ui'
import { docs, docsEmpty, NOW, remembers } from './fixtures'
import { MemoryDocsPage, type MemoryDocsPageProps } from './MemoryDocsPage'
import { PinList } from './RemembersPage'

const noop = () => {}
const pins = <PinList page={remembers} now={NOW} onEditStart={noop} onDraftChange={noop} onSave={noop} onCancel={noop} onRemove={noop} />
const page = (props: Pick<MemoryDocsPageProps, 'page'> & Partial<MemoryDocsPageProps>) =>
  fixture<MemoryDocsPageProps>({ now: NOW, onEditStart: noop, onAddStart: noop, onDraftChange: noop, onSave: noop, onCancel: noop, onDelete: noop, pinned: pins, ...props })

/** What Juno remembers (SPEC 13.8): Juno's notes about the owner by doc, with sources, the pins, and the recent changes. */
export default defineFixtures(
  MemoryDocsPage,
  {
    Notes: {
      list: page({ page: docs }),
      editing: page({ page: docs, editing: { _tag: 'edit', id: docs.docs[1]!.entries[1]!.id, draft: 'Priya Raman: manager. 1:1 on Thursdays at 11.' } }),
      adding: page({ page: docs, editing: { _tag: 'add', doc: 'preferences', draft: 'Never schedule anything before 10' } }),
      refused: page({ page: docs, editing: { _tag: 'add', doc: 'preferences', draft: 'my api key is sk-test-0000', error: 'That looks like a key or a password. Juno never keeps those.' } }),
      empty: page({ page: docsEmpty, pinned: <PinList page={{ pins: [], usedBytes: 0, budgetBytes: 4096 }} now={NOW} onEditStart={noop} onDraftChange={noop} onSave={noop} onCancel={noop} onRemove={noop} /> }),
    },
  },
  { width: 960, height: 900, padded: false },
)
