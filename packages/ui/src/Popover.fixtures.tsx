import { ArrowLeftRight, Bell, CircleDot, Hash, LogOut, Settings, Sparkles } from 'lucide-react'
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
          <OptionRow id="status" leading={<Icon icon={CircleDot} size={15} />} label="Set status" />
          <OptionRow id="notifications" leading={<Icon icon={Bell} size={15} />} label="Notifications" sub="Next digest 3pm" />
          <OptionRow id="prefs" leading={<Icon icon={Settings} size={15} />} label="Preferences" trailing={<Kbd>⌘,</Kbd>} />
          <OptionRow id="ai" leading={<Icon icon={Sparkles} size={15} />} label="AI assist" />
        </OptionList>
        <OptionSeparator />
        <OptionList role="menu" label="Workspace">
          <OptionRow id="switch" leading={<Icon icon={ArrowLeftRight} size={15} />} label="Switch workspace" />
          <OptionRow id="signout" leading={<Icon icon={LogOut} size={15} />} label="Sign out" />
        </OptionList>
      </Popover>
    ),
    { width: 320, height: 440 },
  ),
})
