import { defineFixtures, fixture } from '@juno/ui'
import { EmptyChat, type EmptyChatProps } from './EmptyChat'

const noop = () => {}

export default defineFixtures(
  EmptyChat,
  {
    Empty: {
      'what-do-you-need': fixture<EmptyChatProps>({ onSuggest: noop, enter: false }),
      'pill-hover': fixture<EmptyChatProps>({ onSuggest: noop, enter: false }, { width: 720, padded: true, hover: '[data-chat-empty] button' }),
      'pill-focus': fixture<EmptyChatProps>({ onSuggest: noop, enter: false }, { width: 720, padded: true, focus: '[data-chat-empty] button' }),
    },
  },
  { width: 720, padded: true },
)
