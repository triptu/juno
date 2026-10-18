import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { defineFixtures, fixture } from './fixtures/define'
import { Icon } from './Icon'
import { SelectButton } from './Select'

export default defineFixtures(SelectButton, {
  Value: {
    placeholder: fixture({ size: 28, placeholder: true, children: 'Choose a channel' }),
    chosen: fixture({ size: 28, leading: <Icon icon={Hash} size={13} />, children: 'deploys' }),
    expanded: fixture({ size: 28, leading: <Icon icon={Hash} size={13} />, expanded: true, children: 'deploys' }),
  },
  Interaction: {
    focus: fixture({ size: 28, placeholder: true, children: 'Choose a channel' }, { focus: 'button' }),
  },
})
