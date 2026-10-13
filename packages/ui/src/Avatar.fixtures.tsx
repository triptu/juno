import { Avatar, hueNames } from './Avatar'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'

// A stand-in for a Slack profile photo: a flat SVG, so the gallery needs no
// network and the shot is stable.
const photo = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#8EB5C9"/><circle cx="32" cy="26" r="12" fill="#F4E6D3"/><path d="M10 64c2-14 11-20 22-20s20 6 22 20Z" fill="#F4E6D3"/></svg>',
)}`
// Bytes that are not an image, so the browser fires error and the initials stay.
const brokenPhoto = 'data:image/png;base64,AAAA'
// A photo that never arrives. The gallery's dev and preview servers hold this
// request open (apps/gallery/vite.config.ts), so the initials stay and the
// state holds still. Tests answer it themselves to check the photo arriving.
export const pendingPhotoUrl = '/__fixture/pending.png'

export default defineFixtures(Avatar, {
  Kind: {
    person: fixture({ kind: 'person', label: 'MC', name: 'Maya Chen', hue: 'claret', size: 44 }),
    group: fixture({ kind: 'group', label: 'ML', name: 'Maya Chen, Leo Park', hue: 'midnight', size: 44 }),
  },
  Photo: {
    // The photo has not arrived: the initials show and the box is already its final size.
    pending: fixture({ label: 'MC', name: 'Maya Chen', hue: 'claret', size: 44, src: pendingPhotoUrl }),
    loaded: fixture({ label: 'MC', name: 'Maya Chen', hue: 'claret', size: 44, src: photo }),
    // The photo failed: the initials never left.
    failed: fixture({ label: 'MC', name: 'Maya Chen', hue: 'claret', size: 44, src: brokenPhoto }),
  },
  Overview: {
    'photo-sizes': scene(() => (
      <Row>
        <Avatar label="MC" hue="claret" size={44} src={photo} />
        <Avatar label="MC" hue="claret" size={32} src={photo} />
        <Avatar label="MC" hue="claret" size={28} src={photo} />
        <Avatar label="MC" hue="claret" size={24} src={photo} />
        <Avatar label="MC" hue="claret" size={20} src={photo} />
        <Avatar label="MC" hue="claret" size={18} src={photo} />
      </Row>
    )),
    'photo-and-initials': scene(() => (
      <Row>
        <Avatar label="MC" name="Maya Chen" hue="claret" size={32} src={photo} />
        <Avatar label="LP" name="Leo Park" hue="midnight" size={32} />
        <Avatar label="DP" name="Dev Patel" hue="cyan" size={32} src={brokenPhoto} />
      </Row>
    )),
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
  },
})
