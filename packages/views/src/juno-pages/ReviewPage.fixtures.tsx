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
      // After a move: the code to check against the old Mac.
      'after-move': page({ page: { backupAt: NOW - 5 * 60_000, moveCode: '7KQ2-M9XA', pending: [sendMessage('rv1', mayHaveHappened)] } }),
      // A new Mac with no move code: Juno cannot tell this is the newest backup.
      unchecked: page({ page: { backupAt: NOW - DAY, unchecked: true, pending: [sendMessage('rv1', mayHaveHappened), resolve('rv2', mayHaveHappened)] } }),
    },
  },
  { width: 960, height: 880, padded: false },
)
