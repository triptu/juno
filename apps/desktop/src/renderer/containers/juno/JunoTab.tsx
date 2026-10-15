import { useState } from 'react'
import { junoAboutAtom, registry } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { JunoHeader, JunoPanelContext } from '@juno/views'
import { openJunoPage, resumeJuno } from './actions'
import { JunoChat } from './JunoChat'
import { chipContext } from './JunoPanel'
import { NoProviderFrame, useNoProvider } from './NoProviderFrame'

/**
 * The Juno tab (SPEC 13.1, inventory 12): the one chat in the 720px column,
 * opened at the "New" divider or the bottom. Ask Juno with no topic tab
 * active lands here, with its About chip above the composer. With no model
 * provider set up it says so and offers to add one.
 */
export function JunoTab() {
  return useNoProvider() ? <NoProviderFrame column="page" /> : <TabChat />
}

function TabChat() {
  const about = useAtomValue(junoAboutAtom)
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <JunoChat
      column="page"
      header={(banner) => <JunoHeader banner={banner} menuOpen={menuOpen} onMenu={setMenuOpen} onOpenPage={openJunoPage} onResume={resumeJuno} />}
      contextOf={() => (about === undefined ? undefined : chipContext(about))}
      composerContext={about === undefined ? undefined : <JunoPanelContext about={about} onRemoveAbout={() => registry.set(junoAboutAtom, undefined)} />}
    />
  )
}
