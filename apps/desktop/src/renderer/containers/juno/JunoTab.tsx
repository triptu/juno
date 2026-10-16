import { useState } from 'react'
import { JUNO_TAB_ABOUT, junoAboutAtom, registry } from '@juno/state'
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
export function JunoTab({ tabId }: { readonly tabId: string }) {
  return useNoProvider() ? <NoProviderFrame column="page" /> : <TabChat tabId={tabId} />
}

function TabChat({ tabId }: { readonly tabId: string }) {
  const about = useAtomValue(junoAboutAtom(JUNO_TAB_ABOUT))
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <JunoChat
      column="page"
      draftKey={`tab:${tabId}`}
      header={(banner) => <JunoHeader banner={banner} menuOpen={menuOpen} onMenu={setMenuOpen} onOpenPage={openJunoPage} onResume={resumeJuno} />}
      contextOf={() => (about === undefined ? undefined : chipContext(about))}
      composerContext={about === undefined ? undefined : <JunoPanelContext about={about} onRemoveAbout={() => registry.set(junoAboutAtom(JUNO_TAB_ABOUT), undefined)} />}
    />
  )
}
