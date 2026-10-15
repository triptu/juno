import { useState, type ReactNode } from 'react'
import { agentProviderAtom } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { JunoChatFrame, JunoHeader, NoProvider } from '@juno/views'
import { openJunoPage } from './actions'

/**
 * Whether the agent can run: a provider is active. Until main has answered
 * the chat shows as usual, since a provider is the common case.
 */
export function useNoProvider(): boolean {
  return useAtomValue(agentProviderAtom, (state) => state !== undefined && state.active === null)
}

/**
 * The Juno tab or panel with no model provider (SPEC 13.10): the same
 * header, "Juno needs a model" under it, and no composer. Add a provider
 * opens Settings › Juno.
 */
export function NoProviderFrame({ column, actions }: { readonly column: 'page' | 'panel'; readonly actions?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <JunoChatFrame
      header={
        <JunoHeader
          column={column}
          banner={{ _tag: 'none' }}
          menuOpen={menuOpen}
          onMenu={setMenuOpen}
          onOpenPage={openJunoPage}
          onResume={() => {}}
          {...(actions === undefined ? {} : { actions })}
        />
      }
      composer={null}
    >
      <NoProvider column={column} onAddProvider={() => openJunoPage('settings')} />
    </JunoChatFrame>
  )
}
