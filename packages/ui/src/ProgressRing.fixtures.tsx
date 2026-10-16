import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { ProgressRing } from './ProgressRing'

const label = 'Sync progress'

export default defineFixtures(ProgressRing, {
  Value: {
    unknown: fixture({ label }),
    empty: fixture({ label, value: 0, max: 148 }),
    'part way': fixture({ label, value: 11, max: 148 }),
    half: fixture({ label, value: 74, max: 148 }),
    done: fixture({ label, value: 148, max: 148 }),
  },
  Size: {
    all: scene(() => (
      <Row>
        <ProgressRing label={label} value={40} max={148} size={16} />
        <ProgressRing label={label} value={40} max={148} size={20} />
      </Row>
    )),
  },
})
