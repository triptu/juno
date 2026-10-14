import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { ContextPill } from './ContextPill'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'

export default defineFixtures(ContextPill, {
  Kind: {
    public: fixture({ tint: 'public', icon: Hash, name: 'eng', kindLabel: 'Public channel', showKind: true }),
    private: fixture({ tint: 'private', icon: Lock, name: 'hiring', kindLabel: 'Private channel', showKind: true }),
    dm: fixture({ tint: 'dm', icon: User, name: 'Maya Chen', kindLabel: 'Direct message', showKind: true }),
    group: fixture({ tint: 'dm', icon: Users, name: 'Maya, Leo', kindLabel: 'Group DM', showKind: true }),
  },
  Layout: {
    small: fixture({ tint: 'public', icon: Hash, name: 'eng', kindLabel: 'Public channel', showKind: true, size: 22 }),
    'to-field': fixture({ tint: 'public', icon: Hash, name: 'eng', kindLabel: 'Public channel', showKind: true, size: 28 }),
    'name-only': fixture({ tint: 'dm', icon: User, name: 'Maya Chen', kindLabel: 'Direct message' }),
    // The page header's pill: the name only, a button whose name carries the kind.
    header: fixture({ tint: 'private', icon: Lock, name: 'hiring', kindLabel: 'Private channel', size: 24, onClick: () => {}, label: 'hiring, private channel. Show in sidebar.' }),
  },
  Interaction: {
    'header-focus': fixture({ tint: 'public', icon: Hash, name: 'eng', kindLabel: 'Public channel', size: 24, onClick: () => {}, label: 'eng, public channel. Show in sidebar.' }, { focus: 'button' }),
  },
  Overview: {
    'all-kinds': scene(() => (
      <Row gap="sm">
        <ContextPill tint="public" icon={Hash} name="eng" kindLabel="Public channel" showKind />
        <ContextPill tint="private" icon={Lock} name="hiring" kindLabel="Private channel" showKind />
        <ContextPill tint="dm" icon={User} name="Maya Chen" kindLabel="Direct message" showKind />
        <ContextPill tint="dm" icon={Users} name="Maya, Leo" kindLabel="Group DM" showKind />
      </Row>
    )),
  },
})
