import { DEFAULT_QUICK_REACTIONS, emojiCatalog } from '@juno/contract'
import { defineFixtures, fixture } from '@juno/ui'
import { EmojiPicker } from './EmojiPicker'
import { fiveQuickReactions, sevenQuickReactions } from './fixtures/quickReactions'
import { QuickReactionsSetting } from './QuickReactionsSetting'

const noop = () => {}

export default defineFixtures(
  QuickReactionsSetting,
  {
    Reactions: {
      default: fixture({ reactions: DEFAULT_QUICK_REACTIONS, onChange: noop, onAdd: noop }),
      five: fixture({ reactions: fiveQuickReactions, onChange: noop, onAdd: noop }),
      // Add is disabled at seven.
      full: fixture({ reactions: sevenQuickReactions, onChange: noop, onAdd: noop }),
      // One left cannot be removed.
      one: fixture({ reactions: DEFAULT_QUICK_REACTIONS.slice(0, 1), onChange: noop, onAdd: noop }),
      adding: fixture(
        { reactions: fiveQuickReactions, onChange: noop, onAdd: noop, picker: <EmojiPicker catalog={emojiCatalog} recent={['+1', 'eyes']} onPick={noop} onClose={noop} /> },
        { height: 480 },
      ),
    },
    Interaction: {
      'hover-pill': fixture({ reactions: fiveQuickReactions, onChange: noop, onAdd: noop }, { hover: '[data-quick-reaction]' }),
      'focus-pill': fixture({ reactions: fiveQuickReactions, onChange: noop, onAdd: noop }, { focus: '[data-quick-reaction="+1"]' }),
      'hover-add': fixture({ reactions: fiveQuickReactions, onChange: noop, onAdd: noop }, { hover: '[aria-label="Add reaction"]' }),
    },
  },
  { width: 520 },
)
