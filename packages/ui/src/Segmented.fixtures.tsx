import { defineFixtures, fixture } from './fixtures/define'
import { Segmented } from './Segmented'

const options = [
  { value: 'now', label: 'Now' },
  { value: 'digest', label: 'Digest' },
  { value: 'silent', label: 'Silent' },
]

export default defineFixtures(Segmented, {
  now: fixture({ options, value: 'now', onChange: () => {}, label: 'Decision' }),
  digest: fixture({ options, value: 'digest', onChange: () => {}, label: 'Decision' }),
  silent: fixture({ options, value: 'silent', onChange: () => {}, label: 'Decision' }),
  hover: fixture({ options, value: 'now', onChange: () => {}, label: 'Decision' }, { hover: '[role="radio"]:nth-of-type(2)' }),
  'active-press': fixture({ options, value: 'now', onChange: () => {}, label: 'Decision' }, { press: '[role="radio"]:nth-of-type(2)' }),
  disabled: fixture({ options, value: 'digest', onChange: () => {}, label: 'Decision', disabled: true }),
})
