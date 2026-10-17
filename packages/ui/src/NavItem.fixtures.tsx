import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { SparkleDuotone } from './duotone'
import { Chip } from './Chip'
import { defineFixtures, scene } from './fixtures/define'
import { Stack } from './fixtures/layout'
import { NavItem } from './NavItem'

function Nav({ active = 'all' }: { readonly active?: 'all' | 'juno' }) {
  return (
    <Stack gap="sm" width={260}>
      <NavItem icon={ListBullets} active={active === 'all'}>
        All topics
      </NavItem>
      {/* Juno stays duotone whether or not it is active: the one AI surface. */}
      <NavItem
        icon={SparkleDuotone}
        active={active === 'juno'}
        kbd="⌘J"
        trailing={
          <Chip variant="filled" numeric>
            2
          </Chip>
        }
      >
        Juno
      </NavItem>
    </Stack>
  )
}

export default defineFixtures(
  NavItem,
  {
    Selection: {
      nav: scene(() => <Nav />),
      'juno-active': scene(() => <Nav active="juno" />),
    },
    Interaction: {
      hover: scene(() => <Nav />, { hover: '[role="button"]:nth-of-type(2)' }),
      'hover-active': scene(() => <Nav />, { hover: '[role="button"]:nth-of-type(1)' }),
      focus: scene(() => <Nav />, { focus: '[role="button"]:nth-of-type(2)' }),
    },
  },
  { surface: 'subtle' },
)
