import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { Pebble } from './Pebble'

export default defineFixtures(Pebble, {
  Look: {
    default: fixture({ seed: 'signin/a/right/3', size: 200 }),
    'accent-band': fixture({ seed: 'signin/a/right/3', size: 200, accentBand: true }),
  },
  Overview: {
    sizes: scene(() => (
      <Row>
        <Pebble seed="signin/a/left/4" size={60} />
        <Pebble seed="signin/a/left/2" size={120} />
        <Pebble seed="signin/a/left/1" size={180} accentBand />
      </Row>
    )),
  },
})
