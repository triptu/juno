import { useState, type ReactNode } from 'react'
import { junoAvailableAtom } from '@juno/state'
import { agentProviderAtom, junoSettingsAtom } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { JunoChatFrame, JunoHeader, NoProvider } from '@juno/views'
import { openSettings } from '../navigation'
import { openJunoPage } from './actions'

/**
 * Whether the agent can run: a provider is active. Until main has answered
 * the chat shows as usual, since a provider is the common case. With AI
 * assist off the chat shows instead, with its "Juno is off" line (SPEC 13.7):
 * adding a provider would not turn Juno on.
 */
export function useNoProvider(): boolean {
  const aiOn = useAtomValue(junoAvailableAtom)
  const noApi = useAtomValue(agentProviderAtom, (state) => state !== undefined && state.active === null)
  const local = useAtomValue(junoSettingsAtom, result => result._tag === 'Success' && result.value.chatModels.some(model => model.provider === 'codex' && model.selected))
  return aiOn && noApi && !local
}

/**
 * The Juno tab or panel with no model provider (SPEC 13.10): the same
 * header, "Juno needs a model" under it, and no composer. Add a provider
 * opens Settings at Juno, with focus in the key field.
 */
export function NoProviderFrame({ column, actions }: { readonly column: 'page' | 'panel'; readonly actions?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <JunoChatFrame
      column={column}
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
      <NoProvider column={column} onAddProvider={() => openSettings('juno')} />
    </JunoChatFrame>
  )
}
