import { defineFixtures, fixture } from '@juno/ui'
import { NOW, scheduled } from './fixtures'
import { ScheduledPage, type ScheduledPageProps } from './ScheduledPage'

const noop = () => {}
const page = (props: Pick<ScheduledPageProps, 'page'>) => fixture<ScheduledPageProps>({ ...props, now: NOW, onPause: noop, onResume: noop, onEdit: noop, onDelete: noop })

export default defineFixtures(
  ScheduledPage,
  {
    Scheduled: {
      list: page({ page: scheduled }),
      empty: page({ page: { schedules: [] } }),
    },
  },
  { width: 960, height: 560, padded: false },
)
