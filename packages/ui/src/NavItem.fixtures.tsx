import { Lightbulb } from '@phosphor-icons/react/dist/icons/Lightbulb'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { Chip } from './Chip'
import { defineFixtures, scene } from './fixtures/define'
import { Stack } from './fixtures/layout'
import { NavItem } from './NavItem'

function Nav({ active = 'all' }: { readonly active?: 'all' | 'for-you' | 'juno' }) {
  return (
    <Stack gap="sm" width={260}>
      <NavItem icon={ListBullets} active={active === 'all'}>
        All topics
      </NavItem>
      <NavItem
        icon={Lightbulb}
        active={active === 'for-you'}
        trailing={
          <Chip variant="strong" numeric>
            5
          </Chip>
        }
      >
        For you
      </NavItem>
      {/* Juno stays duotone whether or not it is active: the one AI surface. */}
      <NavItem icon={Sparkle} iconWeight="duotone" active={active === 'juno'} kbd="⌘J">
        Juno
      </NavItem>
    </Stack>
  )
}

export default defineFixtures(
  NavItem,
  {
    nav: scene(() => <Nav />),
    'for-you-active': scene(() => <Nav active="for-you" />),
    'juno-active': scene(() => <Nav active="juno" />),
    hover: scene(() => <Nav />, { hover: '[role="button"]:nth-of-type(2)' }),
    'hover-active': scene(() => <Nav />, { hover: '[role="button"]:nth-of-type(1)' }),
    focus: scene(() => <Nav />, { focus: '[role="button"]:nth-of-type(2)' }),
  },
  { surface: 'subtle' },
)
