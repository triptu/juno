import { defineFixtures, fixture } from '@juno/ui'
import { WelcomeCard, type WelcomeCardProps, type WelcomeHintName } from './WelcomeCard'

const noop = () => {}

const state = (done: ReadonlyArray<WelcomeHintName>, props: Partial<WelcomeCardProps> = {}) => fixture<WelcomeCardProps>({ done, peekKey: 'option', onClose: noop, ...props })

export default defineFixtures(
  WelcomeCard,
  {
    States: {
      fresh: state([]),
      'one-done': state(['peek']),
      'two-done': state(['peek', 'juno']),
      'all-set': state(['peek', 'tab', 'juno']),
      // Settings › General's peek key is Space: the first hint says so.
      'space-peek': state([], { peekKey: 'space' }),
      // Home's column at the minimum window: each hint takes two lines.
      narrow: fixture<WelcomeCardProps>({ done: ['tab'], peekKey: 'option', onClose: noop }, { width: 288 }),
      // Its room, kept with nothing in it.
      hidden: state([], { hidden: true }),
    },
    Interaction: {
      'hover-hide': fixture<WelcomeCardProps>({ done: [], peekKey: 'option', onClose: noop }, { hover: '[data-welcome-close]' }),
      'focus-hide': fixture<WelcomeCardProps>({ done: [], peekKey: 'option', onClose: noop }, { focus: '[data-welcome-close]' }),
    },
  },
  { width: 480, padded: true },
)
