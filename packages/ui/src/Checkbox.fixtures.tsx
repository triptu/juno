import { Checkbox } from './Checkbox'
import { defineFixtures, fixture } from './fixtures/define'

export default defineFixtures(
  Checkbox,
  {
    Value: {
      unchecked: fixture({
        label: 'Include muted channels',
        description: 'Show muted channels in search results.',
        defaultChecked: false,
      }),
      checked: fixture({
        label: 'Let Juno decide',
        description: 'Each message gets a quick read on urgency. Off means everything waits for a digest.',
        size: 'lg',
        defaultChecked: true,
      }),
      'no-description': fixture({ label: 'Include muted channels', defaultChecked: false }),
    },
    Interaction: {
      hover: fixture({ label: 'Include muted channels', defaultChecked: false }, { hover: 'input' }),
    },
    Availability: {
      disabled: fixture({
        label: 'Let Juno decide',
        description: 'Turn AI assist on in Settings to use this.',
        defaultChecked: true,
        disabled: true,
      }),
    },
  },
  { width: 520 },
)
