import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { Logo } from './Logo'
import { Text } from './Text'

export default defineFixtures(Logo, {
  Look: {
    default: fixture({ size: 40, label: 'Juno' }),
    // The mark takes the surrounding text colour.
    'with-text': scene(() => (
      <Row gap="sm">
        <Text tone="subtle">
          <Logo size={20} />
        </Text>
        <Text tone="subtle" variant="ui">
          Juno
        </Text>
      </Row>
    )),
  },
  Overview: {
    'all-sizes': scene(() => (
      <Row>
        <Logo size={16} />
        <Logo size={18} />
        <Logo size={20} />
        <Logo size={24} />
        <Logo size={28} />
        <Logo size={32} />
        <Logo size={40} />
        <Logo size={44} />
      </Row>
    )),
  },
})
