import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { sizes } from '@juno/tokens/tokens.stylex'
import { defineFixtures, fixture, scene, Text } from '@juno/ui'
import { ReactionPicker, type ReactionPickerProps } from './ReactionPicker'

const noop = () => {}

const picker = (overrides: Partial<ReactionPickerProps> = {}) => fixture<ReactionPickerProps>({ onPick: noop, ...overrides })

/** Pick, pick the same to remove, or type any emoji and press Enter. */
function Live() {
  const [selected, setSelected] = useState<string | undefined>(undefined)
  return (
    <>
      <ReactionPicker {...(selected === undefined ? {} : { selected })} onPick={(emoji) => setSelected(emoji ?? undefined)} />
      <span {...stylex.props(styles.line)}>
        <Text variant="meta" tone="muted">
          {selected === undefined ? 'No reaction' : `Reacted ${selected}`}
        </Text>
      </span>
    </>
  )
}

// One fixed line: an emoji glyph is taller than text, and the line must not grow when one appears.
const styles = stylex.create({
  line: { display: 'flex', alignItems: 'center', height: sizes['--control-22'], overflow: 'hidden' },
})

export default defineFixtures(
  ReactionPicker,
  {
    Picker: {
      empty: picker(),
      selected: picker({ selected: '🎉' }),
      live: scene(() => <Live />),
    },
  },
  { width: 320, padded: true },
)
