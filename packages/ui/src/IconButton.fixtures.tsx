import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { Moon } from '@phosphor-icons/react/dist/icons/Moon'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { PushPin } from '@phosphor-icons/react/dist/icons/PushPin'
import { Quotes } from '@phosphor-icons/react/dist/icons/Quotes'
import { Smiley } from '@phosphor-icons/react/dist/icons/Smiley'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { IconButton } from './IconButton'

function AllVariants() {
  return (
    <Row>
      <IconButton icon={Quotes} label="Quote" variant="ghost" />
      <IconButton icon={Quotes} label="Quote" variant="secondary" />
      <IconButton icon={ArrowUp} label="Send" variant="primary" radius="full" size={28} iconWeight="bold" />
      <IconButton icon={Quotes} label="Quote" variant="raised" />
    </Row>
  )
}

export default defineFixtures(IconButton, {
  'Titlebar and header': {
    titlebar: fixture({ icon: MagnifyingGlass, label: 'Search ⌘K', size: 30 }),
    pressed: fixture({ icon: Hash, label: 'Browse channels and people', size: 30, pressed: true }),
    header: fixture({ icon: PushPin, label: 'Pin', size: 32 }),
    // Toggles: outline when off, filled when on.
    'header-pressed': fixture({ icon: PushPin, label: 'Unpin', size: 32, pressed: true }),
    subscribe: fixture({ icon: Bell, label: 'Subscribe', size: 32, pressed: false }),
    subscribed: fixture({ icon: Bell, label: 'Subscribed. Click to unsubscribe.', size: 32, pressed: true }),
  },
  Composer: {
    send: fixture({ icon: ArrowUp, label: 'Send', size: 28, radius: 'full', variant: 'primary', iconWeight: 'bold' }),
    attach: fixture({ icon: Plus, label: 'Attach', size: 28, radius: 'full', iconSize: 20 }),
  },
  Dismiss: {
    close: fixture({ icon: X, label: 'Close tab', size: 20, iconSize: 13, tone: 'muted' }),
    dismiss: fixture({ icon: X, label: 'Dismiss', size: 22, radius: 'sm', tone: 'muted' }),
  },
  Availability: {
    disabled: scene(() => (
      <Row>
        <IconButton icon={Quotes} label="Quote" variant="ghost" disabled />
        <IconButton icon={Quotes} label="Quote" variant="secondary" disabled />
        <IconButton icon={ArrowUp} label="Send" variant="primary" radius="full" size={28} iconWeight="bold" disabled />
        <IconButton icon={Quotes} label="Quote" variant="raised" disabled />
      </Row>
    )),
    'send-dimmed': fixture({ icon: ArrowUp, label: 'Send', size: 28, radius: 'full', variant: 'primary', iconWeight: 'bold', dimmed: true }),
  },
  Hover: {
    hover: scene(() => <AllVariants />, { hover: 'button' }),
    'hover-secondary': fixture({ icon: Quotes, label: 'Quote', variant: 'secondary' }, { hover: 'button' }),
    'hover-raised': fixture({ icon: Quotes, label: 'Quote', variant: 'raised' }, { hover: 'button' }),
    'hover-toggle-on': fixture({ icon: Bell, label: 'Subscribed. Click to unsubscribe.', size: 32, pressed: true }, { hover: 'button' }),
  },
  Press: {
    'active-press': fixture({ icon: PushPin, label: 'Pin', size: 32 }, { press: 'button' }),
    'active-press-primary': fixture({ icon: ArrowUp, label: 'Send', size: 28, radius: 'full', variant: 'primary', iconWeight: 'bold' }, { press: 'button' }),
  },
  Focus: {
    'focus-toggle': fixture({ icon: Bell, label: 'Subscribe', size: 32, pressed: false }, { focus: 'button' }),
  },
  Overview: {
    'all-sizes': scene(() => (
      <Row>
        <IconButton icon={X} label="Close" size={20} />
        <IconButton icon={X} label="Dismiss" size={22} radius="sm" />
        <IconButton icon={X} label="Remove rule" size={26} iconSize={13} tone="muted" />
        <IconButton icon={Smiley} label="More reactions" size={28} />
        <IconButton icon={Moon} label="Toggle theme" size={30} />
        <IconButton icon={Bell} label="Subscribed. Click to unsubscribe." size={32} />
        <IconButton icon={DotsThree} label="More" size={32} iconWeight="bold" />
        <IconButton icon={NotePencil} label="New message" size={36} />
      </Row>
    )),
    'all-variants': scene(() => (
      <Row>
        <AllVariants />
        <IconButton icon={Quotes} label="Quote" variant="ghost" disabled />
      </Row>
    )),
  },
})
