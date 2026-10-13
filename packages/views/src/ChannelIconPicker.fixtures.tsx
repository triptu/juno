import { useState } from 'react'
import { defineFixtures, fixture, scene, type ChannelColorName, type ChannelIconName } from '@juno/ui'
import { ChannelIconPicker } from './ChannelIconPicker'

const noop = () => {}

/** Holds the choice locally so the gallery can be clicked through. */
function Live() {
  const [icon, setIcon] = useState<ChannelIconName | undefined>('rocket')
  const [color, setColor] = useState<ChannelColorName>('cyan')
  return <ChannelIconPicker name="eng" icon={icon} color={color} onIconChange={setIcon} onColorChange={setColor} />
}

export default defineFixtures(
  ChannelIconPicker,
  {
    Choice: {
      letter: fixture({ name: 'eng', color: 'emeraldDark', onIconChange: noop, onColorChange: noop }),
      chosen: fixture({ name: 'eng', icon: 'rocket', color: 'cyan', onIconChange: noop, onColorChange: noop }),
    },
    Interactive: {
      live: scene(() => <Live />),
    },
    Interaction: {
      'icon-hover': fixture({ name: 'eng', icon: 'rocket', color: 'cyan', onIconChange: noop, onColorChange: noop }, { hover: '[aria-label="Bug"]' }),
      'icon-press': fixture({ name: 'eng', icon: 'rocket', color: 'cyan', onIconChange: noop, onColorChange: noop }, { press: '[aria-label="Bug"]' }),
      'icon-focus': fixture({ name: 'eng', icon: 'rocket', color: 'cyan', onIconChange: noop, onColorChange: noop }, { focus: '[aria-label="Bug"]' }),
      'color-hover': fixture({ name: 'eng', icon: 'rocket', color: 'cyan', onIconChange: noop, onColorChange: noop }, { hover: '[aria-label="Claret"]' }),
      'color-press': fixture({ name: 'eng', icon: 'rocket', color: 'cyan', onIconChange: noop, onColorChange: noop }, { press: '[aria-label="Claret"]' }),
    },
  },
  { width: 360, surface: 'surface' },
)
