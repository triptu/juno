import { defineFixtures, fixture } from '@juno/ui'
import { fiveQuickReactions, sevenQuickReactions } from './fixtures/quickReactions'
import { HoverToolbar } from './HoverToolbar'

const noop = () => {}

export default defineFixtures(HoverToolbar, {
  Where: {
    thread: fixture({ onMore: noop }),
    main: fixture({ main: true, onMore: noop }),
  },
  // Chosen in Settings › Appearance: up to seven, custom emoji too.
  Reactions: {
    five: fixture({ main: true, reactions: fiveQuickReactions, onMore: noop }),
    seven: fixture({ main: true, reactions: sevenQuickReactions, onMore: noop }),
    one: fixture({ main: true, reactions: fiveQuickReactions.slice(0, 1), onMore: noop }),
  },
  // Delete on your own message asks once, in the toolbar's place (ADR 0010).
  Confirm: {
    'confirm-delete': fixture({ confirmDelete: { onConfirm: noop, onCancel: noop } }),
    'hover-delete': fixture({ confirmDelete: { onConfirm: noop, onCancel: noop } }, { hover: 'button:last-of-type' }),
  },
  Interaction: {
    'hover-reaction': fixture({ main: true, onMore: noop }, { hover: 'button' }),
    'hover-quote': fixture({ main: true, onMore: noop }, { hover: '[aria-label="Quote"]' }),
    'hover-more': fixture({ main: true, onMore: noop }, { hover: '[aria-label="More"]' }),
    'press-reaction': fixture({ main: true, onMore: noop }, { press: 'button' }),
    'focus-start-thread': fixture({ main: true, onMore: noop }, { focus: '[aria-label="Start thread"]' }),
    'focus-open-thread': fixture({ main: true, hasThread: true, onMore: noop }, { focus: '[aria-label="Open thread"]' }),
  },
})
