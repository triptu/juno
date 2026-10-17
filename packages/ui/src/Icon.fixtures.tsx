import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lightbulb } from '@phosphor-icons/react/dist/icons/Lightbulb'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { PushPin } from '@phosphor-icons/react/dist/icons/PushPin'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { BellDuotone, SparkleDuotone } from './duotone'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row, Stack } from './fixtures/layout'
import { Icon } from './Icon'
import { Text } from './Text'

export default defineFixtures(Icon, {
  Style: {
    default: fixture({ icon: Hash }),
    dim: fixture({ icon: Hash, size: 15, dim: true }),
    labelled: fixture({ icon: CheckCircle, size: 14, label: 'Resolved' }),
    active: fixture({ icon: Bell, size: 18, active: true }),
    duotone: fixture({ icon: SparkleDuotone, size: 16 }),
  },
  Overview: {
    'all-sizes': scene(() => (
      <Row>
        <Icon icon={Sparkle} size={12} />
        <Icon icon={Sparkle} size={13} />
        <Icon icon={Sparkle} size={14} />
        <Icon icon={Sparkle} size={15} />
        <Icon icon={Sparkle} size={16} />
        <Icon icon={Sparkle} size={18} />
        <Icon icon={Sparkle} size={20} />
      </Row>
    )),
    // Bold at 13 next to 11px tag text, regular at 16 next to 13px text.
    'next-to-text': scene(() => (
      <Stack gap="sm">
        <Row gap="sm">
          <Icon icon={Hash} size={13} />
          <Text variant="tag" tone="muted">
            eng
          </Text>
          <Icon icon={ChatCircle} size={13} />
          <Text variant="tag" tone="muted" numeric>
            7
          </Text>
        </Row>
        <Row gap="sm">
          <Icon icon={Hash} size={16} />
          <Text variant="ui">eng</Text>
        </Row>
      </Stack>
    )),
    weights: scene(() => (
      <Row>
        <Icon icon={Bell} size={18} weight="regular" />
        <Icon icon={Bell} size={14} weight="bold" />
        <Icon icon={Bell} size={18} weight="fill" />
        <Icon icon={BellDuotone} size={18} />
      </Row>
    )),
    'outline-and-fill': scene(() => (
      <Row>
        <Icon icon={Bell} size={18} />
        <Icon icon={Bell} size={18} active />
        <Icon icon={PushPin} size={18} />
        <Icon icon={PushPin} size={18} active />
        <Icon icon={Lightbulb} size={16} />
        <Icon icon={Lightbulb} size={16} active />
      </Row>
    )),
    'common-set': scene(() => (
      <Row>
        <Icon icon={Hash} />
        <Icon icon={Lock} />
        <Icon icon={User} />
        <Icon icon={Users} />
        <Icon icon={ChatCircle} />
        <Icon icon={ChatsCircle} />
        <Icon icon={PushPin} />
        <Icon icon={Bell} />
        <Icon icon={MagnifyingGlass} />
        <Icon icon={SparkleDuotone} />
      </Row>
    )),
  },
})
