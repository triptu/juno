import { useState } from 'react'
import { defineFixtures, fixture, scene } from '@juno/ui'
import { ReactionPicker, type ReactionPickerProps } from './ReactionPicker'

const noop = () => {}

const picker = (overrides: Partial<ReactionPickerProps> = {}) => fixture<ReactionPickerProps>({ onPick: noop, ...overrides })

/** Pick, pick the same to remove, or type any emoji and press Enter. The chosen one is filled. */
function Live() {
  const [selected, setSelected] = useState<string | undefined>(undefined)
  return <ReactionPicker {...(selected === undefined ? {} : { selected })} onPick={(emoji) => setSelected(emoji ?? undefined)} />
}

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
