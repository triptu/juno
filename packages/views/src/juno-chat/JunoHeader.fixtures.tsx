import { useState } from 'react'
import type { Banner } from '@juno/agent-contract'
import { Button, defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { JunoHeader, type JunoHeaderProps } from './JunoHeader'

const noop = () => {}

const header = (banner: Banner, overrides: Partial<JunoHeaderProps> = {}, frame?: FixtureFrame) => fixture<JunoHeaderProps>({ banner, menuOpen: false, onMenu: noop, onOpenPage: noop, onResume: noop, ...overrides }, frame)

/** Every banner in precedence order, lowest first. The title and the menu never move as the chip changes. */
const order: ReadonlyArray<Banner> = [{ _tag: 'none' }, { _tag: 'offline' }, { _tag: 'paused' }, { _tag: 'aiOff' }, { _tag: 'recovery', pending: 2 }, { _tag: 'updateNeeded' }, { _tag: 'otherDevice', deviceName: 'Tushar’s MacBook Air' }]

function Cycles() {
  const [index, setIndex] = useState(0)
  const banner = order[index] ?? order[0]!
  return (
    <>
      <JunoHeader banner={banner} menuOpen={false} onMenu={noop} onOpenPage={noop} onResume={noop} />
      <Button variant="secondary" size="sm" onClick={() => setIndex((i) => (i + 1) % order.length)}>
        Next banner
      </Button>
    </>
  )
}

const frame: FixtureFrame = { width: 816, padded: false }

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
    },
    Menu: {
      open: header({ _tag: 'none' }, { menuOpen: true }, { ...frame, height: 320 }),
    },
    Interaction: {
      'resume-hover': header({ _tag: 'paused' }, {}, { ...frame, hover: '[data-banner] button' }),
      'menu-focus': header({ _tag: 'none' }, {}, { ...frame, focus: '[aria-label="More"]' }),
    },
    Shift: {
      'banner-cycles': scene(() => <Cycles />, { ...frame, padded: true }),
    },
  },
  frame,
)
