import { DayToggles } from './DayToggles'
import { defineFixtures, fixture } from './fixtures/define'

const base = { onChange: () => {}, label: 'Notification days' }

export default defineFixtures(DayToggles, {
  Value: {
    weekdays: fixture({ ...base, days: [1, 2, 3, 4, 5] }),
    'every-day': fixture({ ...base, days: [0, 1, 2, 3, 4, 5, 6] }),
    none: fixture({ ...base, days: [] }),
  },
  Interaction: {
    'hover-off': fixture({ ...base, days: [1, 2, 3, 4, 5] }, { hover: 'button:nth-of-type(6)' }),
    'hover-on': fixture({ ...base, days: [1, 2, 3, 4, 5] }, { hover: 'button:nth-of-type(2)' }),
    press: fixture({ ...base, days: [1, 2, 3, 4, 5] }, { press: 'button:nth-of-type(6)' }),
    focus: fixture({ ...base, days: [1, 2, 3, 4, 5] }, { focus: 'button:nth-of-type(1)' }),
  },
})
