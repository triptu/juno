import * as stylex from '@stylexjs/stylex'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lightbulb } from '@phosphor-icons/react/dist/icons/Lightbulb'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, scene } from './fixtures/define'
import { IconButton } from './IconButton'
import { Tab, TabStrip } from './Tabs'
import { Text } from './Text'

const newTab = <IconButton icon={Plus} label="New message" size={28} iconSize={16} tone="muted" />

/** A strip over a page body, so the active tab is seen merging with the page. */
function StripWithPage() {
  return (
    <div {...stylex.props(styles.window)}>
      <TabStrip trailing={newTab}>
        <Tab icon={Hash} label="eng" onClose={() => {}} />
        <Tab icon={Hash} label="Postgres 16 migration plan" active onClose={() => {}} />
        <Tab icon={ListBullets} label="All topics" onClose={() => {}} />
      </TabStrip>
      <div {...stylex.props(styles.page)}>
        <Text variant="topicTitle" tone="default">
          Postgres 16 migration plan
        </Text>
      </div>
    </div>
  )
}

export default defineFixtures(
  TabStrip,
  {
    'two-tabs': scene(() => (
      <TabStrip trailing={newTab}>
        <Tab icon={Hash} label="Postgres 16 migration plan" active onClose={() => {}} />
        <Tab icon={Hash} label="Thread list density" onClose={() => {}} />
      </TabStrip>
    )),
    'with-page': scene(() => <StripWithPage />, { height: 160 }),
    'with-page-narrow': scene(() => <StripWithPage />, { width: 480, height: 160 }),
    'with-page-wide': scene(() => <StripWithPage />, { width: 1400, height: 160 }),
    hover: scene(() => <StripWithPage />, { height: 160, hover: '[role="tab"]:nth-of-type(1)' }),
    'close-hover': scene(() => <StripWithPage />, { height: 160, hover: '[role="tab"]:nth-of-type(2) button' }),
    stealth: scene(() => (
      <TabStrip trailing={newTab}>
        <Tab icon={Hash} label="eng" onClose={() => {}} />
        <Tab icon={EyeSlash} label="Rina Sato · Staff backend" active onClose={() => {}} />
        <Tab icon={Lightbulb} label="For you" onClose={() => {}} />
      </TabStrip>
    )),
    many: scene(() => (
      <TabStrip trailing={newTab}>
        <Tab icon={Hash} label="Postgres 16 migration plan" onClose={() => {}} />
        <Tab icon={Lock} label="Rina Sato · Staff backend" onClose={() => {}} />
        <Tab icon={Hash} label="Q4 roadmap cuts" active onClose={() => {}} />
        <Tab icon={Hash} label="Staging bill doubled since August" onClose={() => {}} />
        <Tab icon={Lightbulb} label="For you" onClose={() => {}} />
      </TabStrip>
    )),
    'many-narrow': scene(
      () => (
        <TabStrip trailing={newTab}>
          <Tab icon={Hash} label="Postgres 16 migration plan" onClose={() => {}} />
          <Tab icon={Lock} label="Rina Sato · Staff backend" onClose={() => {}} />
          <Tab icon={Hash} label="Q4 roadmap cuts" active onClose={() => {}} />
          <Tab icon={Hash} label="Staging bill doubled since August" onClose={() => {}} />
          <Tab icon={Lightbulb} label="For you" onClose={() => {}} />
        </TabStrip>
      ),
      { width: 480 },
    ),
  },
  { width: 720, padded: false },
)

const styles = stylex.create({
  window: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
  },
  page: {
    flexGrow: 1,
    paddingBlock: spacing['--space-5'],
    paddingInline: spacing['--space-6'],
    backgroundColor: colors['--background'],
  },
})
