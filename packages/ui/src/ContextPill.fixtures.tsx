import { ContextPill } from './ContextPill'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'

export default defineFixtures(ContextPill, {
  public: fixture({ kind: 'public', name: 'eng', showKind: true }),
  private: fixture({ kind: 'private', name: 'hiring', showKind: true }),
  dm: fixture({ kind: 'dm', name: 'Maya Chen', showKind: true }),
  group: fixture({ kind: 'group', name: 'Maya, Leo', showKind: true }),
  small: fixture({ kind: 'public', name: 'eng', showKind: true, size: 22 }),
  'to-field': fixture({ kind: 'public', name: 'eng', showKind: true, size: 28 }),
  'name-only': fixture({ kind: 'dm', name: 'Maya Chen' }),
  'all-kinds': scene(() => (
    <Row gap="sm">
      <ContextPill kind="public" name="eng" showKind />
      <ContextPill kind="private" name="hiring" showKind />
      <ContextPill kind="dm" name="Maya Chen" showKind />
      <ContextPill kind="group" name="Maya, Leo" showKind />
    </Row>
  )),
})
