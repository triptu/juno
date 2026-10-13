import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { Kbd } from './Kbd'

export default defineFixtures(Kbd, {
  Look: {
    plain: fixture({ children: '⌘J' }),
    key: fixture({ look: 'key', children: 'esc' }),
  },
  Overview: {
    all: scene(() => (
      <Row>
        <Kbd>⌘J</Kbd>
        <Kbd>⌘Z</Kbd>
        <Kbd>↵</Kbd>
        <Kbd>⌘ click</Kbd>
        <Kbd look="key">esc</Kbd>
      </Row>
    )),
  },
})
