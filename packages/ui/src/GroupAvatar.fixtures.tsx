import type { AvatarStackPerson } from './AvatarStack'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { GroupAvatar } from './GroupAvatar'
import { Row } from './fixtures/layout'
import { Text } from './Text'

const photo = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/><circle cx="32" cy="26" r="12" fill="#F4E6D3"/><path d="M10 64c2-14 11-20 22-20s20 6 22 20Z" fill="#F4E6D3"/></svg>`,
  )}`

const maya: AvatarStackPerson = { id: 'u1', initials: 'MC', name: 'Maya Chen', hue: 'claret', src: photo('#8EB5C9') }
const leo: AvatarStackPerson = { id: 'u2', initials: 'LP', name: 'Leo Park', hue: 'midnight', src: photo('#A7B8A0') }
const dev: AvatarStackPerson = { id: 'u3', initials: 'DP', name: 'Dev Patel', hue: 'cyan' }
const priya: AvatarStackPerson = { id: 'u4', initials: 'PR', name: 'Priya Raman', hue: 'plum' }

export default defineFixtures(GroupAvatar, {
  Members: {
    photos: fixture({ people: [maya, leo, dev], name: 'Maya, Leo, Dev' }),
    // One photo: it goes in front, the other member shows their initial.
    'one-photo': fixture({ people: [dev, maya], name: 'Dev, Maya' }),
    'no-photos': fixture({ people: [dev, priya], name: 'Dev, Priya' }),
  },
  Size: {
    // Home's destination mark, in Recent and the destination lists.
    'mark-20': scene(() => (
      <Row>
        <GroupAvatar people={[maya, leo]} size={20} />
        <Text variant="body">Maya, Leo</Text>
        <GroupAvatar people={[dev, priya]} size={20} />
        <Text variant="body">Dev, Priya</Text>
      </Row>
    )),
    // The tab's icon slot, beside a tab title.
    'tab-16': scene(() => (
      <Row>
        <GroupAvatar people={[maya, leo]} size={16} />
        <Text variant="body">Maya, Leo</Text>
        <GroupAvatar people={[dev, priya]} size={16} />
        <Text variant="body">Dev, Priya</Text>
      </Row>
    )),
  },
})
