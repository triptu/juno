import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { chat } from '@juno/tokens/tokens.stylex'
import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { JunoHeader, JunoPanelActions, type JunoView } from '../juno-chat/JunoHeader'
import { ActivityPage } from './ActivityPage'
import { activity, memory, NOW, remembers, scheduled } from './fixtures'
import { JunoPageFrame } from './JunoPageFrame'
import { MemoryPage } from './MemoryPage'
import { RemembersPage } from './RemembersPage'
import { ScheduledPage } from './ScheduledPage'

const noop = () => {}

/** A Juno page under the Juno header, as the Juno tab (`page`) or the Juno panel (`panel`) shows it. */
function framed(current: JunoView, page: ReactNode, column: 'page' | 'panel' = 'page', menuOpen = false) {
  const frame = (
    <JunoPageFrame
      column={column}
      header={
        <JunoHeader
          column={column}
          current={current}
          banner={{ _tag: 'none' }}
          menuOpen={menuOpen}
          onMenu={noop}
          onOpenPage={noop}
          onResume={noop}
          {...(column === 'panel' ? { actions: <JunoPanelActions onOpenInTab={noop} onClose={noop} /> } : {})}
        />
      }
    >
      {page}
    </JunoPageFrame>
  )
  // The panel's own fill, as the workspace's side draws it.
  return column === 'panel' ? <div {...stylex.props(styles.panel)}>{frame}</div> : frame
}

const styles = stylex.create({
  panel: {
    display: 'flex',
    width: '100%',
    height: '100%',
    backgroundColor: chat['--panel-fill'],
  },
})

const activityPage = (open: ReadonlyArray<string> = []) => <ActivityPage page={activity} now={NOW} onCopyDetails={noop} onLoadMore={noop} initiallyOpen={open} />

const tab: FixtureFrame = { width: 960, height: 760, padded: false }
// The panel beside a topic at its usual width.
const panel: FixtureFrame = { width: 360, height: 760, padded: false }

export default defineFixtures(
  JunoPageFrame,
  {
    Activity: {
      tab: scene(() => framed('activity', activityPage()), tab),
      'tab-open-run': scene(() => framed('activity', activityPage(['r1'])), tab),
      'tab-menu': scene(() => framed('activity', activityPage(), 'page', true), tab),
      panel: scene(() => framed('activity', activityPage(), 'panel'), panel),
      'panel-open-run': scene(() => framed('activity', activityPage(['r7']), 'panel'), panel),
      'panel-menu': scene(() => framed('activity', activityPage(), 'panel', true), panel),
    },
    'Other pages': {
      scheduled: scene(() => framed('scheduled', <ScheduledPage page={scheduled} now={NOW} onPause={noop} onResume={noop} onEdit={noop} onDelete={noop} />), tab),
      remembers: scene(
        () => framed('remembers', <RemembersPage page={remembers} now={NOW} onEditStart={noop} onDraftChange={noop} onSave={noop} onCancel={noop} onRemove={noop} />, 'panel'),
        panel,
      ),
      memory: scene(() => framed('memory', <MemoryPage page={memory} now={NOW} />), tab),
    },
  },
  tab,
)
