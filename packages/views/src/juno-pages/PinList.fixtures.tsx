import { defineFixtures, fixture } from '@juno/ui'
import { NOW, remembers, remembersFull } from './fixtures'
import { PinList, type PinListProps } from './PinList'

const noop = () => {}
const page = (props: Pick<PinListProps, 'page'> & Partial<PinListProps>) => fixture<PinListProps>({ now: NOW, onEditStart: noop, onDraftChange: noop, onSave: noop, onCancel: noop, onRemove: noop, ...props })

export default defineFixtures(
  PinList,
  {
    Pins: {
      list: page({ page: remembers }),
      editing: page({ page: remembers, editing: { id: remembers.pins[0]!.id, draft: 'The offsite is on the 23rd, in Lisbon' } }),
      'changed-under-edit': page({ page: remembers, editing: { id: remembers.pins[3]!.id, draft: 'Never message #general for me, ever' } }),
      full: page({ page: remembersFull }),
      empty: page({ page: { pins: [], usedBytes: 0, budgetBytes: 4096 } }),
    },
  },
  { width: 640, height: 480 },
)
