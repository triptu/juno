import { defineFixtures, fixture, type FixtureFrame } from '@juno/ui'
import { ActiveThreads } from './ActiveThreads'
import { details, engThreads } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { TopicHeader, type TopicHeaderProps } from './TopicHeader'

const noop = () => {}

const base: Pick<TopicHeaderProps, 'onSubscribe' | 'onUnsubscribe' | 'onRename'> = { onSubscribe: noop, onUnsubscribe: noop, onRename: noop }

const state = (props: Partial<TopicHeaderProps> & Pick<TopicHeaderProps, 'detail'>, frame?: FixtureFrame) => fixture<TopicHeaderProps>({ ...base, ...props }, frame)

const threads = <ActiveThreads threads={engThreads} now={NOW} onOpen={noop} onSubscribe={noop} onUnsubscribe={noop} />

export default defineFixtures(
  TopicHeader,
  {
    Thread: {
      'public-ai-title': state({ detail: details.postgres }),
      'manual-title': state({ detail: details.offsite }),
      private: state({ detail: details.hiring }),
      'direct-message': state({ detail: details.offsite }),
      unsubscribed: state({ detail: details.flags }),
    },
    Main: {
      'channel-main': state({ detail: details.engMain, onThreads: noop }),
      'threads-open': state({ detail: details.engMain, onThreads: noop, threadsOpen: true, threads }, { height: 520 }),
      'group-dm-main': state({ detail: details.lunch, onThreads: noop }),
    },
    Content: {
      'long-title': state({ detail: details.long }),
      'right-to-left': state({ detail: details.mohammed }),
      'emoji-title': state({ detail: details.unicorn }),
      narrow: state({ detail: details.hiring }, { width: 720 }),
      wide: state({ detail: details.engMain, onThreads: noop }, { width: 1600 }),
    },
    // The workspace at the minimum window size (720 by 480) is 336px wide.
    'Minimum width': {
      'main-336': state({ detail: details.engMain, onThreads: noop }, { width: 336 }),
      'thread-336': state({ detail: details.long }, { width: 336 }),
      'threads-open-336': state({ detail: details.engMain, onThreads: noop, threadsOpen: true, threads }, { width: 336, height: 520 }),
    },
    Interaction: {
      'hover-subscribe': state({ detail: details.postgres }, { hover: 'button[aria-pressed]' }),
      'focus-subscribe': state({ detail: details.postgres }, { focus: 'button[aria-pressed]' }),
      'hover-threads': state({ detail: details.engMain, onThreads: noop }, { hover: 'button[aria-expanded]' }),
    },
  },
  { width: 816, padded: false },
)
