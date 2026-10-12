import { defineFixtures, fixture } from './fixtures/define'
import { Slider } from './Slider'

export default defineFixtures(Slider, {
  default: fixture({ min: 50, max: 95, step: 5, value: 80, label: 'Urgency threshold', valueText: '80%', readOnly: true }),
  low: fixture({ min: 50, max: 95, step: 5, value: 50, label: 'Urgency threshold', valueText: '50%', readOnly: true }),
  high: fixture({ min: 50, max: 95, step: 5, value: 95, label: 'Urgency threshold', valueText: '95%', readOnly: true }),
})
