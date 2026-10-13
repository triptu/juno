import { defineFixtures, fixture, scene } from '@juno/ui'
import { ActiveThreads, type ActiveThreadsProps } from './ActiveThreads'
import { engThreads } from './fixtures/messages'
import { NOW } from './fixtures/topics'

const noop = () => {}

const state = (props: Partial<ActiveThreadsProps> = {}, frame?: Parameters<typeof fixture>[1]) =>
  fixture<ActiveThreadsProps>({ threads: engThreads, now: NOW, onOpen: noop, onSubscribe: noop, onUnsubscribe: noop, ...props }, frame)

export default defineFixtures(
  ActiveThreads,
  {
    List: {
      full: state(),
      'one-thread': state({ threads: engThreads.slice(0, 1) }),
      empty: state({ threads: [] }),
      loading: state({ threads: [], status: 'loading' }),
    },
    Interaction: {
      'hover-row': state({}, { hover: '[role="listitem"]' }),
      'hover-bell': state({}, { hover: '[role="listitem"] button' }),
      'focus-row': state({}, { focus: '[role="listitem"]' }),
    },
    Overview: {
      'in-a-popover-width': scene(() => <ActiveThreads threads={engThreads} now={NOW} onOpen={noop} onSubscribe={noop} onUnsubscribe={noop} />, { width: 300, padded: false, surface: 'surface' }),
    },
  },
  { width: 360, padded: false, surface: 'surface' },
)
