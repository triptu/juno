import { Avatar, hueNames } from './Avatar'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'

export default defineFixtures(Avatar, {
  person: fixture({ kind: 'person', label: 'MC', name: 'Maya Chen', hue: 'claret', size: 44 }),
  channel: fixture({ kind: 'channel', label: 'E', name: 'eng', size: 44 }),
  group: fixture({ kind: 'group', label: 'ML', name: 'Maya Chen, Leo Park', hue: 'midnight', size: 44 }),
  'all-hues': scene(() => (
    <Row>
      {hueNames.map((hue, index) => (
        <Avatar key={hue} label={['MC', 'LP', 'DP', 'SO', 'PR', 'JW', 'ER', 'RS'][index] ?? 'AB'} hue={hue} size={32} />
      ))}
    </Row>
  )),
  'all-sizes': scene(() => (
    <Row>
      <Avatar label="MC" hue="midnight" size={44} />
      <Avatar label="MC" hue="midnight" size={36} />
      <Avatar label="MC" hue="midnight" size={32} />
      <Avatar label="MC" hue="midnight" size={28} />
      <Avatar label="MC" hue="midnight" size={24} />
      <Avatar label="MC" hue="midnight" size={20} />
      <Avatar label="MC" hue="midnight" size={18} />
    </Row>
  )),
  'tile-sizes': scene(() => (
    <Row>
      <Avatar kind="channel" label="E" size={44} />
      <Avatar kind="channel" label="E" size={36} />
      <Avatar kind="channel" label="E" size={32} />
      <Avatar kind="channel" label="E" size={28} />
    </Row>
  )),
})
