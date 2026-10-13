import { ArrowsLeftRight } from '@phosphor-icons/react/dist/icons/ArrowsLeftRight'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { DotOutline } from '@phosphor-icons/react/dist/icons/DotOutline'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { SignOut } from '@phosphor-icons/react/dist/icons/SignOut'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { Avatar } from './Avatar'
import { defineFixtures, scene } from './fixtures/define'
import { IconButton } from './IconButton'
import { Icon } from './Icon'
import { Kbd } from './Kbd'
import { OptionHeader, OptionList, OptionRow, OptionSeparator } from './OptionList'
import { Popover } from './Popover'

export default defineFixtures(Popover, {
  'account-menu': scene(
    () => (
      <Popover open onClose={() => {}} width="account" placement="bottom-start" role="menu" label="Account" anchor={<IconButton icon={Hash} label="Account and preferences" size={30} />}>
        <OptionHeader leading={<Avatar label="T" name="Tushar" hue="cyan" size={32} />} title="Tushar" sub="acme.slack.com" />
        <OptionSeparator />
        <OptionList role="menu" label="Account">
          <OptionRow id="status" leading={<Icon icon={DotOutline} size={16} />} label="Set status" />
          <OptionRow id="notifications" leading={<Icon icon={Bell} size={16} />} label="Notifications" sub="Next digest 3pm" />
          <OptionRow id="prefs" leading={<Icon icon={Gear} size={16} />} label="Preferences" trailing={<Kbd>⌘,</Kbd>} />
          <OptionRow id="ai" leading={<Icon icon={Sparkle} size={16} weight="duotone" />} label="AI assist" />
        </OptionList>
        <OptionSeparator />
        <OptionList role="menu" label="Workspace">
          <OptionRow id="switch" leading={<Icon icon={ArrowsLeftRight} size={16} />} label="Switch workspace" />
          <OptionRow id="signout" leading={<Icon icon={SignOut} size={16} />} label="Sign out" />
        </OptionList>
      </Popover>
    ),
    { width: 320, height: 440 },
  ),
})
