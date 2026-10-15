import { defineFixtures, fixture } from '@juno/ui'
import { aboutChannel, aboutPerson } from './fixtures/data'
import { JunoPanelContext, type JunoPanelContextProps } from './JunoPanelContext'

const noop = () => {}

const context = (props: JunoPanelContextProps) => fixture<JunoPanelContextProps>(props)

const selection = { text: 'logical replication to the new cluster, cut over behind the read-only flag', sender: 'Leo Park' }
const long = {
  text: 'Draft plan is in the doc. Short version: logical replication to the new cluster, cut over behind the read-only flag, about a 4 minute write freeze. Rollback is the old primary, which stays warm for a day. We need a reviewer from the platform team before Thursday, and someone to own the comms in #incidents.',
  sender: 'Leo Park',
}

export default defineFixtures(
  JunoPanelContext,
  {
    Context: {
      'catch-me-up': context({ onCatchMeUp: noop }),
      selection: context({ selection, onRemoveSelection: noop }),
      'selection-long': context({ selection: long, onRemoveSelection: noop }),
      'selection-and-catch-up': context({ selection, onRemoveSelection: noop, onCatchMeUp: noop }),
      'about-person': context({ about: aboutPerson, onRemoveAbout: noop }),
      'about-channel': context({ about: aboutChannel, onRemoveAbout: noop }),
      // An About chip replaces Catch me up.
      'about-hides-catch-up': context({ about: aboutPerson, onRemoveAbout: noop, onCatchMeUp: noop }),
      nothing: context({}),
    },
    Interaction: {
      'hover-catch-me-up': { ...context({ onCatchMeUp: noop }), frame: { width: 336, padded: true, hover: '[data-catch-me-up]' } },
      'focus-remove': { ...context({ about: aboutPerson, onRemoveAbout: noop }), frame: { width: 336, padded: true, focus: '[aria-label="Remove"]' } },
    },
  },
  { width: 336, padded: true },
)
