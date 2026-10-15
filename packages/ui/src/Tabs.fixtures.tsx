import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { House } from '@phosphor-icons/react/dist/icons/House'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, scene } from './fixtures/define'
import { IconButton } from './IconButton'
import { Tab, TabStrip } from './Tabs'
import { Text } from './Text'

const newTab = <IconButton icon={Plus} label="New tab" size={28} iconSize={16} tone="muted" />

const titles = ['Postgres 16 migration plan', 'Rina Sato · Staff backend', 'Q4 roadmap cuts', 'Staging bill doubled since August', 'Thread list density', 'Offsite: Wednesday afternoon slot', 'Can eng review the launch checklist']

/** Thirty-seven tabs, the last one active: the strip scrolls and keeps it in view. */
function ThirtySeven() {
  return (
    <TabStrip trailing={newTab}>
      {Array.from({ length: 37 }, (_, index) => (
        <Tab key={index} icon={index % 5 === 1 ? Lock : Hash} label={`${titles[index % titles.length]} ${index + 1}`} active={index === 36} onClose={() => {}} />
      ))}
    </TabStrip>
  )
}

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
    Strip: {
      'two-tabs': scene(() => (
        <TabStrip trailing={newTab}>
          <Tab icon={Hash} label="Postgres 16 migration plan" active onClose={() => {}} />
          <Tab icon={Hash} label="Thread list density" onClose={() => {}} />
        </TabStrip>
      )),
      many: scene(() => (
        <TabStrip trailing={newTab}>
          <Tab icon={Hash} label="Postgres 16 migration plan" onClose={() => {}} />
          <Tab icon={Lock} label="Rina Sato · Staff backend" onClose={() => {}} />
          <Tab icon={Hash} label="Q4 roadmap cuts" active onClose={() => {}} />
          <Tab icon={Hash} label="Staging bill doubled since August" onClose={() => {}} />
        </TabStrip>
      )),
      'many-narrow': scene(
        () => (
          <TabStrip trailing={newTab}>
            <Tab icon={Hash} label="Postgres 16 migration plan" onClose={() => {}} />
            <Tab icon={Lock} label="Rina Sato · Staff backend" onClose={() => {}} />
            <Tab icon={Hash} label="Q4 roadmap cuts" active onClose={() => {}} />
            <Tab icon={Hash} label="Staging bill doubled since August" onClose={() => {}} />
            </TabStrip>
        ),
        { width: 480 },
      ),
      'thirty-seven': scene(() => <ThirtySeven />),
      'thirty-seven-narrow': scene(() => <ThirtySeven />, { width: 336 }),
      'pinned-and-unread': scene(() => (
        <TabStrip trailing={newTab}>
          <Tab icon={House} label="Home" pinned />
          <Tab icon={Hash} label="Rina Sato · Staff backend" pinned unread />
          <Tab icon={Hash} label="Postgres 16 migration plan" active onClose={() => {}} />
          <Tab icon={Hash} label="design-review" unread onClose={() => {}} />
          <Tab icon={ListBullets} label="All topics" onClose={() => {}} />
        </TabStrip>
      )),
      'unread-narrow': scene(
        () => (
          <TabStrip trailing={newTab}>
            <Tab icon={Hash} label="Postgres 16 migration plan" unread onClose={() => {}} />
            <Tab icon={Lock} label="Rina Sato · Staff backend" unread onClose={() => {}} />
            <Tab icon={Hash} label="Q4 roadmap cuts" active unread onClose={() => {}} />
            <Tab icon={Hash} label="Staging bill doubled since August" onClose={() => {}} />
          </TabStrip>
        ),
        { width: 480 },
      ),
    },
    'With page': {
      'with-page': scene(() => <StripWithPage />, { height: 160 }),
      'with-page-narrow': scene(() => <StripWithPage />, { width: 480, height: 160 }),
      'with-page-wide': scene(() => <StripWithPage />, { width: 1400, height: 160 }),
    },
    Interaction: {
      hover: scene(() => <StripWithPage />, { height: 160, hover: '[data-tab]:nth-of-type(1) [role="tab"]' }),
      'close-hover': scene(() => <StripWithPage />, { height: 160, hover: '[data-tab]:nth-of-type(2) button' }),
      'pinned-hover': scene(
        () => (
          <TabStrip trailing={newTab}>
            <Tab icon={House} label="Home" pinned />
            <Tab icon={Hash} label="Postgres 16 migration plan" active onClose={() => {}} />
          </TabStrip>
        ),
        { hover: '[data-tab]:nth-of-type(1) [role="tab"]' },
      ),
      'narrow-hover': scene(() => <ThirtySeven />, { hover: '[data-tab]:nth-of-type(33) [role="tab"]' }),
      'narrow-focus-tab': scene(() => <ThirtySeven />, { focus: '[data-tab]:nth-of-type(34) [role="tab"]' }),
    },
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
