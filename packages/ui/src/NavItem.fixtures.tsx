import { LayoutList, Lightbulb, Sparkles } from 'lucide-react'
import { Chip } from './Chip'
import { defineFixtures, scene } from './fixtures/define'
import { Stack } from './fixtures/layout'
import { NavItem } from './NavItem'

function Nav() {
  return (
    <Stack gap="sm" width={260}>
      <NavItem icon={LayoutList} active>
        All topics
      </NavItem>
      <NavItem
        icon={Lightbulb}
        trailing={
          <Chip variant="strong" numeric>
            5
          </Chip>
        }
      >
        For you
      </NavItem>
      <NavItem icon={Sparkles} kbd="⌘J">
        Juno
      </NavItem>
    </Stack>
  )
}

export default defineFixtures(
  NavItem,
  {
    nav: scene(() => <Nav />),
    hover: scene(() => <Nav />, { hover: '[role="button"]:nth-of-type(2)' }),
    'hover-active': scene(() => <Nav />, { hover: '[role="button"]:nth-of-type(1)' }),
  },
  { surface: 'subtle' },
)
