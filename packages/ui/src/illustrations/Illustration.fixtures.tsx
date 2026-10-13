import { defineFixtures, fixture, scene } from '../fixtures/define'
import { Row } from '../fixtures/layout'
import { Illustration } from './Illustration'

export default defineFixtures(Illustration, {
  'caught-up': fixture({ name: 'caught-up' }),
  'nothing-here': fixture({ name: 'nothing-here' }),
  'nothing-open': fixture({ name: 'nothing-open', size: 'workspace' }),
  'no-results': fixture({ name: 'no-results' }),
  juno: fixture({ name: 'juno', size: 'figure' }),
  'all-list': scene(() => (
    <Row gap="lg">
      <Illustration name="caught-up" />
      <Illustration name="nothing-here" />
      <Illustration name="nothing-open" />
      <Illustration name="no-results" />
      <Illustration name="juno" size="figure" />
    </Row>
  )),
  'all-workspace': scene(() => (
    <Row gap="lg">
      <Illustration name="caught-up" size="workspace" />
      <Illustration name="nothing-here" size="workspace" />
      <Illustration name="nothing-open" size="workspace" />
      <Illustration name="no-results" size="workspace" />
    </Row>
  )),
})
