import { defineFixtures, fixture } from '@juno/ui'
import { NOW, remembers, remembersFull } from './fixtures'
import { RemembersPage, type RemembersPageProps } from './RemembersPage'

const noop = () => {}
const page = (props: Pick<RemembersPageProps, 'page'> & Partial<RemembersPageProps>) => fixture<RemembersPageProps>({ now: NOW, onEditStart: noop, onDraftChange: noop, onSave: noop, onCancel: noop, onRemove: noop, ...props })

export default defineFixtures(
  RemembersPage,
  {
    Pins: {
      list: page({ page: remembers }),
      editing: page({ page: remembers, editing: { id: remembers.pins[0]!.id, draft: 'The offsite is on the 23rd, in Lisbon' } }),
      'changed-under-edit': page({ page: remembers, editing: { id: remembers.pins[3]!.id, draft: 'Never message #general for me, ever' } }),
      full: page({ page: remembersFull }),
      empty: page({ page: { pins: [], usedBytes: 0, budgetBytes: 4096 } }),
    },
  },
  { width: 960, height: 640, padded: false },
)
