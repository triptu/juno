import { ArrowUp, Bell, Ellipsis, Hash, Moon, Pin, Plus, Quote, Search, SmilePlus, SquarePen, X } from 'lucide-react'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { IconButton } from './IconButton'

export default defineFixtures(IconButton, {
  titlebar: fixture({ icon: Search, label: 'Search ⌘K', size: 30 }),
  pressed: fixture({ icon: Hash, label: 'Browse channels and people', size: 30, pressed: true }),
  header: fixture({ icon: Pin, label: 'Pin', size: 32 }),
  'header-pressed': fixture({ icon: Pin, label: 'Unpin', size: 32, pressed: true }),
  send: fixture({ icon: ArrowUp, label: 'Send', size: 28, radius: 'full', variant: 'primary' }),
  'send-dimmed': fixture({ icon: ArrowUp, label: 'Send', size: 28, radius: 'full', variant: 'primary', dimmed: true }),
  attach: fixture({ icon: Plus, label: 'Attach', size: 28, radius: 'full', iconSize: 18 }),
  close: fixture({ icon: X, label: 'Close tab', size: 20, tone: 'muted' }),
  dismiss: fixture({ icon: X, label: 'Dismiss', size: 22, radius: 'sm', tone: 'muted' }),
  'all-sizes': scene(() => (
    <Row>
      <IconButton icon={X} label="Close" size={20} />
      <IconButton icon={X} label="Dismiss" size={22} radius="sm" />
      <IconButton icon={X} label="Remove rule" size={26} iconSize={13} tone="muted" />
      <IconButton icon={SmilePlus} label="More reactions" size={28} />
      <IconButton icon={Moon} label="Toggle theme" size={30} />
      <IconButton icon={Bell} label="Subscribed. Click to unsubscribe." size={32} />
      <IconButton icon={Ellipsis} label="More" size={32} />
      <IconButton icon={SquarePen} label="New message" size={36} />
    </Row>
  )),
  'all-variants': scene(() => (
    <Row>
      <IconButton icon={Quote} label="Quote" variant="ghost" />
      <IconButton icon={Quote} label="Quote" variant="secondary" />
      <IconButton icon={ArrowUp} label="Send" variant="primary" radius="full" size={28} />
      <IconButton icon={Quote} label="Quote" variant="raised" />
      <IconButton icon={Quote} label="Quote" variant="ghost" disabled />
    </Row>
  )),
})
