import type { ReactNode } from 'react'
import type { ChatItem } from '@juno/agent-contract'
import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { noopActions } from './commands'
import { aboutPerson, aboutTopic, conversation, day, juno, NOW, owner } from './fixtures/data'
import { JunoChatFrame, type JunoChatFrameProps } from './JunoChatFrame'
import { JunoChatList } from './JunoChatList'
import { JunoComposer } from './JunoComposer'
import { JunoHeader, JunoPanelActions } from './JunoHeader'
import { JunoPanelContext } from './JunoPanelContext'
import { NewMessagesPill } from '../NewMessagesPill'

const noop = () => {}
const MINUTE = 60_000

/** The panel's talk about the topic beside it: About lines over the owner's groups. */
const panelTalk: ReadonlyArray<ChatItem> = [
  day(0),
  owner('m-p1', 'is this settled?', 'single', { _tag: 'sent' }, NOW - 6 * MINUTE, { about: aboutTopic }),
  ...juno('m-p1-r', 'Not yet. Leo asked for a reviewer from platform before Thursday, and nobody has said yes.', { at: NOW - 5 * MINUTE }),
  owner('m-p2', 'what is she working on this week?', 'single', { _tag: 'sent' }, NOW - 2 * MINUTE, { about: aboutPerson }),
  ...juno('m-p2-r', 'Mostly the pricing page and the offsite. She has two threads waiting on you.', { at: NOW - MINUTE }),
]

const tab = (items: ReadonlyArray<ChatItem>, pill = false) =>
  scene<JunoChatFrameProps>(
    () => (
      <JunoChatFrame
        header={<JunoHeader banner={{ _tag: 'none' }} menuOpen={false} onMenu={noop} onOpenPage={noop} onResume={noop} />}
        {...(pill ? { pill: <NewMessagesPill count={0} label="New message" onJump={noop} /> } : {})}
        composer={<JunoComposer value="" onChange={noop} onSend={noop} enabled />}
      >
        <JunoChatList items={items} banner={{ _tag: 'none' }} moreAbove={false} moreBelow={false} now={NOW} actions={noopActions} onSuggest={noop} enterEmpty={false} />
      </JunoChatFrame>
    ),
    { width: 900, height: 640, padded: false },
  )

const panelFrame: FixtureFrame = { width: 360, height: 640, padded: false }

const panel = (items: ReadonlyArray<ChatItem>, context: ReactNode, picker = false) =>
  scene<JunoChatFrameProps>(
    () => (
      <JunoChatFrame
        header={<JunoHeader column="panel" banner={{ _tag: 'none' }} menuOpen={false} onMenu={noop} onOpenPage={noop} onResume={noop} actions={<JunoPanelActions onOpenInTab={noop} onClose={noop} />} />}
        composer={<JunoComposer column="panel" value="" onChange={noop} onSend={noop} enabled placeholder="Ask about this topic" context={context} />}
        {...(picker ? { picker: { x: 300, y: 260, selected: '👍', onPick: noop, onClose: noop } } : {})}
      >
        <JunoChatList column="panel" items={items} banner={{ _tag: 'none' }} moreAbove={false} moreBelow={false} now={NOW} actions={noopActions} onSuggest={noop} enterEmpty={false} />
      </JunoChatFrame>
    ),
    panelFrame,
  )

export default defineFixtures(
  JunoChatFrame,
  {
    Tab: {
      conversation: tab(conversation),
      'about-lines': tab(panelTalk),
      'new-message-pill': tab(conversation, true),
      empty: tab([]),
    },
    Panel: {
      'catch-me-up': panel([], <JunoPanelContext onCatchMeUp={noop} />),
      'about-the-topic': panel(panelTalk, <JunoPanelContext selection={{ text: 'cut over behind the read-only flag', sender: 'Leo Park' }} onRemoveSelection={noop} />),
      'about-chip': panel(panelTalk, <JunoPanelContext about={aboutPerson} onRemoveAbout={noop} />),
      'cards-full-width': panel(conversation, null),
      'reaction-picker': panel(panelTalk, null, true),
    },
  },
  { width: 900, height: 640, padded: false },
)
