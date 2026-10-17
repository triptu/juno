import { defineFixtures, fixture } from '@juno/ui'
import { activity, activityLong, NOW } from './fixtures'
import { ActivityPage, type ActivityPageProps } from './ActivityPage'

const noop = () => {}
const page = (props: Pick<ActivityPageProps, 'page'> & Partial<ActivityPageProps>) => fixture<ActivityPageProps>({ now: NOW, onCopyDetails: noop, onLoadMore: noop, ...props })

export default defineFixtures(
  ActivityPage,
  {
    Activity: {
      runs: page({ page: activity }),
      // A run opened in place: its steps with what each was given and what came back, then its actions.
      open: page({ page: activity, initiallyOpen: ['r1', 'r7'] }),
      long: page({ page: activityLong }),
      empty: page({ page: { runs: [], moreAbove: false } }),
    },
  },
  { width: 960, height: 880, padded: false },
)
