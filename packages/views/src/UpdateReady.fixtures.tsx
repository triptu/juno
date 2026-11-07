import { defineFixtures, fixture } from '@juno/ui'
import { UpdateReady } from './UpdateReady'

const noop = () => {}

// The pill that floats over the sidebar's list once an update has downloaded; `Sidebar` › Update shows it in place.
export default defineFixtures(UpdateReady, { Ready: { default: fixture({ onRestart: noop, onOpen: noop }) } }, { padded: true, surface: 'subtle' })
