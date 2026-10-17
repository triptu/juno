import { memo, useLayoutEffect, useState, type ReactNode } from 'react'
import type { JunoTabPage } from '@juno/state'
import { chatItemsAtom } from '@juno/state/agent'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { JunoHeader, JunoPageFrame, type JunoTarget } from '@juno/views'
import { showJunoView, takeJunoSwitchStart } from '../navigation'
import { resumeJuno } from './actions'
import { useAgentState } from './chatWindow'
import { JunoPageBody } from './JunoPages'

/** A Juno page in its own tab (SPEC 13.10): the switcher there moves within the tab. */
export const JunoPageTab = memo(function JunoPageTab({ page }: { readonly page: JunoTabPage }) {
  return <JunoPageView view={page} column="page" onSwitch={showJunoView} />
})

/** The banner chip over a Juno page: the chat's, read from a one-row window of it. */
const BANNER_WINDOW = { _tag: 'latest', limit: 1 } as const

/**
 * A Juno page under the Juno header, in a Juno tab or the Juno panel (SPEC
 * 13.10): the header's switcher in the same place as over the chat, naming
 * the page. `onSwitch` moves within the tab or the panel.
 */
export function JunoPageView({ view, column, onSwitch, actions }: {
  readonly view: JunoTabPage
  readonly column: 'page' | 'panel'
  readonly onSwitch: (target: JunoTarget) => void
  /** The panel's Open in a tab and Close. */
  readonly actions?: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const agent = useAgentState()
  // A switch to this page ends once it is painted (`juno.page-switch`).
  useLayoutEffect(() => {
    const at = takeJunoSwitchStart()
    if (at !== undefined) afterPaint(() => measure('juno.page-switch', at, { detail: { view, column } }))
  }, [view, column])
  const banner = useAtomValue(chatItemsAtom(BANNER_WINDOW), (result) => (result._tag === 'Success' ? result.value.banner : undefined))
  return (
    <JunoPageFrame
      column={column}
      header={
        <JunoHeader
          column={column}
          current={view}
          banner={agent === 'off' ? { _tag: 'aiOff' } : (banner ?? { _tag: 'none' })}
          menuOpen={menuOpen}
          onMenu={setMenuOpen}
          onOpenPage={onSwitch}
          onResume={resumeJuno}
          {...(actions === undefined ? {} : { actions })}
        />
      }
    >
      <JunoPageBody page={view} />
    </JunoPageFrame>
  )
}
