import { DEFAULT_QUICK_REACTIONS, emojiCatalog } from '@juno/contract'
import { defineFixtures, fixture } from '@juno/ui'
import { EmojiPicker } from './EmojiPicker'
import { fiveQuickReactions, sevenQuickReactions } from './fixtures/quickReactions'
import { QuickReactionsSetting } from './QuickReactionsSetting'

const noop = () => {}
const chosen = (reactions: ReadonlyArray<{ readonly name: string }>) => new Set(reactions.map((reaction) => reaction.name))

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
      // The picker floats under Add, out of the card; the five chosen show as chosen.
      adding: fixture(
        {
          reactions: fiveQuickReactions,
          onChange: noop,
          onAdd: noop,
          picker: <EmojiPicker catalog={emojiCatalog} recent={fiveQuickReactions.map((reaction) => reaction.name)} selected={chosen(fiveQuickReactions)} onPick={noop} onClose={noop} />,
        },
        { height: 480 },
      ),
    },
    Interaction: {
      'hover-pill': fixture({ reactions: fiveQuickReactions, onChange: noop, onAdd: noop }, { hover: '[data-quick-reaction]' }),
      'focus-pill': fixture({ reactions: fiveQuickReactions, onChange: noop, onAdd: noop }, { focus: '[data-quick-reaction="+1"]' }),
      'hover-add': fixture({ reactions: fiveQuickReactions, onChange: noop, onAdd: noop }, { hover: '[aria-label="Add reaction"]' }),
      // At seven Add stays focusable, dimmed, and its tooltip says why.
      'focus-add-full': fixture({ reactions: sevenQuickReactions, onChange: noop, onAdd: noop }, { focus: '[aria-label="Up to 7"]' }),
    },
  },
  { width: 520 },
)
