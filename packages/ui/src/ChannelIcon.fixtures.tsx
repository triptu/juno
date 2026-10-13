import { ChannelIcon, channelColorNames, channelIconNames } from './ChannelIcon'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row, Stack } from './fixtures/layout'

export default defineFixtures(ChannelIcon, {
  Look: {
    // No icon chosen yet: the first letter on the colour hashed from the id.
    default: fixture({ id: 'C0123ENG', name: 'eng', label: 'eng', size: 44 }),
    chosen: fixture({ id: 'C0123ENG', name: 'eng', icon: 'rocket', color: 'cyan', label: 'eng', size: 44 }),
  },
  Overview: {
    'auto-assigned': scene(() => (
      <Row>
        <ChannelIcon id="C01" name="eng" />
        <ChannelIcon id="C02" name="product" />
        <ChannelIcon id="C03" name="hiring" />
        <ChannelIcon id="C04" name="alerts-prod" />
        <ChannelIcon id="C05" name="design" />
        <ChannelIcon id="C06" name="general" />
      </Row>
    )),
    'all-sizes': scene(() => (
      <Row>
        <ChannelIcon name="eng" icon="code" color="midnight" size={44} />
        <ChannelIcon name="eng" icon="code" color="midnight" size={36} />
        <ChannelIcon name="eng" icon="code" color="midnight" size={32} />
        <ChannelIcon name="eng" icon="code" color="midnight" size={28} />
        <ChannelIcon name="eng" icon="code" color="midnight" size={24} />
        <ChannelIcon name="eng" icon="code" color="midnight" size={20} />
        <ChannelIcon name="eng" icon="code" color="midnight" size={18} />
      </Row>
    )),
    'letter-sizes': scene(() => (
      <Row>
        <ChannelIcon name="eng" color="emeraldDark" size={44} />
        <ChannelIcon name="eng" color="emeraldDark" size={36} />
        <ChannelIcon name="eng" color="emeraldDark" size={32} />
        <ChannelIcon name="eng" color="emeraldDark" size={28} />
        <ChannelIcon name="eng" color="emeraldDark" size={24} />
        <ChannelIcon name="eng" color="emeraldDark" size={20} />
        <ChannelIcon name="eng" color="emeraldDark" size={18} />
      </Row>
    )),
    'all-icons': scene(() => (
      <Stack gap="sm">
        <Row gap="sm">
          {channelIconNames.slice(0, 12).map((icon, index) => (
            <ChannelIcon key={icon} name={icon} icon={icon} color={channelColorNames[index % channelColorNames.length]} size={32} />
          ))}
        </Row>
        <Row gap="sm">
          {channelIconNames.slice(12).map((icon, index) => (
            <ChannelIcon key={icon} name={icon} icon={icon} color={channelColorNames[(index + 4) % channelColorNames.length]} size={32} />
          ))}
        </Row>
      </Stack>
    )),
    'all-colors': scene(() => (
      <Row gap="sm">
        {channelColorNames.map((color) => (
          <ChannelIcon key={color} name="eng" icon="hash" color={color} size={32} />
        ))}
      </Row>
    )),
  },
})
