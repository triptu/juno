/**
 * Every primitive's fixtures, keyed by component name. The gallery imports
 * this as `@juno/ui/fixtures` and turns each entry into routes and
 * screenshots. `@juno/views` exposes a `fixtures` record of the same shape.
 */
import type { FixtureSet } from './fixtures/define'
import Avatar from './Avatar.fixtures'
import AvatarStack from './AvatarStack.fixtures'
import Button from './Button.fixtures'
import Card from './Card.fixtures'
import ChannelIcon from './ChannelIcon.fixtures'
import Checkbox from './Checkbox.fixtures'
import Chip from './Chip.fixtures'
import CodeBlock from './CodeBlock.fixtures'
import ContextPill from './ContextPill.fixtures'
import Divider from './Divider.fixtures'
import EmptyState from './EmptyState.fixtures'
import Icon from './Icon.fixtures'
import IconButton from './IconButton.fixtures'
import Illustration from './illustrations/Illustration.fixtures'
import Kbd from './Kbd.fixtures'
import ListRow from './ListRow.fixtures'
import Logo from './Logo.fixtures'
import NavItem from './NavItem.fixtures'
import OptionList from './OptionList.fixtures'
import Page from './Page.fixtures'
import Popover from './Popover.fixtures'
import Segmented from './Segmented.fixtures'
import Select from './Select.fixtures'
import Slider from './Slider.fixtures'
import Surface from './Surface.fixtures'
import Swatch from './Swatch.fixtures'
import Tabs from './Tabs.fixtures'
import Text from './Text.fixtures'
import Textarea from './Textarea.fixtures'
import TextField from './TextField.fixtures'
import Toast from './Toast.fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixtures: Readonly<Record<string, FixtureSet<any>>> = {
  Avatar,
  AvatarStack,
  Button,
  Card,
  ChannelIcon,
  Checkbox,
  Chip,
  CodeBlock,
  ContextPill,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  Illustration,
  Kbd,
  ListRow,
  Logo,
  NavItem,
  OptionList,
  Page,
  Popover,
  Segmented,
  Select,
  Slider,
  Surface,
  Swatch,
  Tabs,
  Text,
  Textarea,
  TextField,
  Toast,
}

export type { Fixture, FixtureFrame, FixtureSet } from './fixtures/define'
