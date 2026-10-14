import { defineFixtures, fixture } from '@juno/ui'
import { noopActions } from '../juno-chat/commands'
import { change, mayHaveHappened, NOW, proposedTask, resolve, sendMessage } from '../juno-chat/fixtures/data'
import { ReviewPage, type ReviewPageProps } from './ReviewPage'

const noop = () => {}
const DAY = 86_400_000
const page = (props: Pick<ReviewPageProps, 'page'>) => fixture<ReviewPageProps>({ ...props, now: NOW, actions: noopActions, onActivate: noop })

export default defineFixtures(
  ReviewPage,
  {
    Review: {
      pending: page({ page: { backupAt: NOW - DAY, pending: [sendMessage('rv1', mayHaveHappened), resolve('rv2', mayHaveHappened), change('rv3', mayHaveHappened), proposedTask('rv4', mayHaveHappened)] } }),
      'nothing-pending': page({ page: { backupAt: NOW - DAY, pending: [] } }),
    },
  },
  { width: 960, height: 1000, padded: false },
)
