import { useLayoutEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { ArrowsOutSimple } from '@phosphor-icons/react/dist/icons/ArrowsOutSimple'
import type { Banner } from '@juno/agent-contract'
import { Button, defineFixtures, fixture, IconButton, scene, type FixtureFrame } from '@juno/ui'
import { noopActions } from './commands'
import { conversation, NOW } from './fixtures/data'
import { JunoChatList } from './JunoChatList'
import { JunoHeader, type JunoHeaderProps } from './JunoHeader'

const noop = () => {}

const header = (banner: Banner, overrides: Partial<JunoHeaderProps> = {}, frame?: FixtureFrame) => fixture<JunoHeaderProps>({ banner, menuOpen: false, onMenu: noop, onOpenPage: noop, onResume: noop, ...overrides }, frame)

/** Every banner in precedence order, lowest first. The title never moves as the chip changes. */
const order: ReadonlyArray<Banner> = [{ _tag: 'none' }, { _tag: 'offline' }, { _tag: 'paused' }, { _tag: 'aiOff' }, { _tag: 'recovery', pending: 2 }, { _tag: 'updateNeeded' }, { _tag: 'otherDevice', deviceName: 'Tushar’s MacBook Air' }]

function Cycles() {
  const [index, setIndex] = useState(0)
  const banner = order[index] ?? order[0]!
  return (
    <>
      <div style={{ position: 'relative', width: '100%', height: 68 }}>
        <JunoHeader banner={banner} menuOpen={false} onMenu={noop} onOpenPage={noop} onResume={noop} />
      </div>
      <Button variant="secondary" size="sm" onClick={() => setIndex((i) => (i + 1) % order.length)}>
        Next banner
      </Button>
    </>
  )
}

/** The header over the chat, the list at its top or scrolled under the band. */
function OverChat({ scrollTop, banner = { _tag: 'none' } }: { readonly scrollTop?: number; readonly banner?: Banner }) {
  const scrollRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (scrollTop !== undefined && scrollRef.current !== null) scrollRef.current.scrollTop = scrollTop
  }, [scrollTop])
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <JunoHeader banner={banner} menuOpen={false} onMenu={noop} onOpenPage={noop} onResume={noop} />
      <JunoChatList items={conversation} banner={banner} moreAbove={false} moreBelow={false} now={NOW} actions={noopActions} onSuggest={noop} scrollRef={scrollRef} enterEmpty={false} />
    </div>
  )
}

/** The panel's right island, for the panel to come (inventory 12.1). */
const panelActions = (
  <>
    <IconButton icon={ArrowsOutSimple} label="Open in a tab" size={28} iconSize={15} radius="full" tone="default" onClick={noop} />
    <IconButton icon={X} label="Close Juno ⌘J" size={28} iconSize={15} radius="full" tone="default" onClick={noop} />
  </>
)

const frame: FixtureFrame = { width: 816, height: 68, padded: false }
const chatFrame: FixtureFrame = { width: 816, height: 560, padded: false }

export default defineFixtures(
  JunoHeader,
  {
    Banner: {
      none: header({ _tag: 'none' }),
      offline: header({ _tag: 'offline' }),
      paused: header({ _tag: 'paused' }),
      'ai-off': header({ _tag: 'aiOff' }),
      recovery: header({ _tag: 'recovery', pending: 2 }),
      'update-needed': header({ _tag: 'updateNeeded' }),
      'other-device': header({ _tag: 'otherDevice', deviceName: 'Tushar’s MacBook Air' }),
      // The Juno tab at the minimum window (336 beside the sidebar): the chip's line shortens, "Juno" and Review stay whole.
      'recovery-minimum-window': header({ _tag: 'recovery', pending: 2 }, {}, { ...frame, width: 336 }),
      'paused-minimum-window': header({ _tag: 'paused' }, {}, { ...frame, width: 336 }),
    },
    Menu: {
      open: header({ _tag: 'none' }, { menuOpen: true }, { ...frame, height: 320 }),
    },
    'Over the chat': {
      'at-top': scene(() => <OverChat />, chatFrame),
      scrolled: scene(() => <OverChat scrollTop={240} banner={{ _tag: 'paused' }} />, chatFrame),
    },
    Panel: {
      'panel-360': header({ _tag: 'none' }, { column: 'panel', actions: panelActions }, { ...frame, width: 360 }),
      'panel-paused': header({ _tag: 'paused' }, { column: 'panel', actions: panelActions }, { ...frame, width: 360 }),
    },
    Interaction: {
      'resume-hover': header({ _tag: 'paused' }, {}, { ...frame, hover: '[data-banner] button' }),
      'menu-focus': header({ _tag: 'none' }, {}, { ...frame, focus: 'button[aria-haspopup="menu"]' }),
    },
    Shift: {
      'banner-cycles': scene(() => <Cycles />, { ...frame, height: 120, padded: true }),
    },
  },
  frame,
)
