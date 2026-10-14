import { defineFixtures, scene, TopicArt } from '@juno/ui'
import type { TopicDetail } from '@juno/contract'
import { details, main, thread } from './fixtures/messages'
import { NOW, rows } from './fixtures/topics'
import { MessageList, type MessageListProps } from './MessageList'
import { PeekView, type PeekViewProps } from './PeekView'
import { SignedIn } from './Shell.fixtures'

interface Peek {
  readonly detail: TopicDetail
  readonly items: MessageListProps['items']
  readonly status?: MessageListProps['status']
  readonly width?: number
}

/** The window with the sidebar, and the peek beside it as the container draws it: no actions on the messages. */
const peek = ({ detail, items, status, width }: Peek, frame?: Parameters<typeof scene>[1]) =>
  scene<PeekViewProps>(
    () => (
      <SignedIn
        {...(width === undefined ? {} : { width })}
        peek={
          <PeekView
            title={detail.kind === 'main' ? detail.channel.label : detail.title}
            {...(detail.kind === 'main' ? {} : { where: detail.channel.label })}
            art={<TopicArt topicId={detail.id} recipe={detail.art} size={20} />}
          >
            <MessageList items={items} main={detail.kind === 'main'} now={NOW} underHeader={false} {...(status === undefined ? {} : { status })} />
          </PeekView>
        }
      />
    ),
    frame,
  )

const overRow = (id: string) => ({ hover: `[data-topic-id="${id}"]` })

export default defineFixtures(
  PeekView,
  {
    Topic: {
      thread: peek({ detail: details.postgres, items: thread }, overRow(rows.postgres.id)),
      'channel-main': peek({ detail: details.engMain, items: main }, overRow(rows.postgres.id)),
    },
    Data: {
      loading: peek({ detail: details.postgres, items: [], status: 'loading' }, overRow(rows.postgres.id)),
      empty: peek({ detail: details.offsite, items: [] }, overRow(rows.offsite.id)),
    },
    Window: {
      'minimum-window': peek({ detail: details.postgres, items: thread, width: 280 }, { width: 720, height: 480, ...overRow(rows.postgres.id) }),
      'widest-sidebar': peek({ detail: details.postgres, items: thread, width: 480 }, { width: 1000, height: 720, ...overRow(rows.postgres.id) }),
    },
  },
  { width: 1200, height: 720, padded: false },
)
