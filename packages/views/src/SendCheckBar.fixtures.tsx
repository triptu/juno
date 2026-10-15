import { defineFixtures, fixture } from '@juno/ui'
import { SendCheckBar, type SendCheckBarProps } from './SendCheckBar'

const noop = () => {}

const state = (props: Pick<SendCheckBarProps, 'finding'>, frame?: Parameters<typeof fixture>[1]) =>
  fixture<SendCheckBarProps>({ ...props, onPrimary: noop, onSecondary: noop }, frame)

const route = { kind: 'route', title: 'Staging bill doubled since August' } as const
const fixes = { kind: 'clarity', fixes: ['recieve → receive', 'the the → the', 'add ?'] } as const

export default defineFixtures(
  SendCheckBar,
  {
    'Wrong place': {
      reply: state({ finding: route }),
      'long-title': state({ finding: { kind: 'route', title: 'Postgres 16 migration plan: logical replication, the read-only flag and a four minute write freeze' } }),
    },
    Clarity: {
      fixes: state({ finding: fixes }),
      'one-fix': state({ finding: { kind: 'clarity', fixes: ['i → I'] } }),
      'fixes-and-long': state({ finding: { ...fixes, note: 'One sentence runs over 40 words.' } }),
      'long-only': state({ finding: { kind: 'clarity', fixes: [], note: 'One sentence runs over 40 words.' } }),
    },
    Interaction: {
      'hover-primary': state({ finding: route }, { hover: 'button:first-of-type' }),
      'hover-secondary': state({ finding: route }, { hover: 'button:last-of-type' }),
      'press-primary': state({ finding: fixes }, { press: 'button:first-of-type' }),
    },
  },
  { width: 752 },
)
