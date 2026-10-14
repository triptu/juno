import { defineFixtures, fixture } from '@juno/ui'
import { activity, NOW } from './fixtures'
import { ActivityPage, type ActivityPageProps } from './ActivityPage'

const noop = () => {}
const page = (props: Pick<ActivityPageProps, 'page'>) => fixture<ActivityPageProps>({ ...props, now: NOW, onCopyDetails: noop, onLoadMore: noop })

export default defineFixtures(
  ActivityPage,
  {
    Activity: {
      runs: page({ page: activity }),
      empty: page({ page: { runs: [], moreAbove: false } }),
    },
  },
  { width: 960, height: 900, padded: false },
)
