import { Checkbox } from './Checkbox'
import { defineFixtures, fixture } from './fixtures/define'

export default defineFixtures(
  Checkbox,
  {
    Value: {
      unchecked: fixture({
        label: 'Track replies as a topic',
        description: 'Slack posts this to Main either way. Replies to it are collected here as their own topic.',
        defaultChecked: false,
      }),
      checked: fixture({
        label: 'Let Juno decide',
        description: 'Each message gets a quick read on urgency. Off means everything waits for a digest.',
        size: 'lg',
        defaultChecked: true,
      }),
      'no-description': fixture({ label: 'Track replies as a topic', defaultChecked: false }),
    },
    Interaction: {
      hover: fixture({ label: 'Track replies as a topic', defaultChecked: false }, { hover: 'input' }),
    },
    Availability: {
      disabled: fixture({
        label: 'Let Juno decide',
        description: 'Turn AI assist on in Preferences to use this.',
        defaultChecked: true,
        disabled: true,
      }),
    },
  },
  { width: 520 },
)
