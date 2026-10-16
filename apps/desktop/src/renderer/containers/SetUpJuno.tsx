import { useEffect, useState } from 'react'
import { chatCopy, modelChoiceKey, type ModelChoice } from '@juno/agent-contract'
import type { ProviderChange } from '@juno/contract'
import { junoSetupPendingAtom, registry } from '@juno/state'
import { agentProviderAtom, codexSetup, junoPageActions, junoSettingsAtom, setAgentProvider } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { CODEX_ENABLED, SetUpJunoView, type ProviderDrafts, type SetUpChoice, type SetUpCodex } from '@juno/views'

const actions = junoPageActions(registry)

const emptyDrafts: ProviderDrafts = { openRouterKey: '', baseUrl: '', customKey: '' }

const providerOf = (choice: SetUpChoice): ModelChoice['provider'] => (choice === 'openRouter' ? 'openrouter' : choice)

/** Leaves the step for the app. With no model set up, the Juno tab says "Juno needs a model" (SPEC 13.7). */
function leave(): void {
  registry.set(junoSetupPendingAtom, false)
}

/** The change that saves what the owner typed for `shown`. */
function changeFor(shown: SetUpChoice, drafts: ProviderDrafts): ProviderChange {
  if (shown === 'openRouter') return { _tag: 'openRouter', key: drafts.openRouterKey.trim() }
  const key = drafts.customKey.trim()
  return { _tag: 'custom', baseUrl: drafts.baseUrl.trim(), ...(key === '' ? {} : { key }) }
}

/** The fixed line for a provider change main refused. */
function refusal(change: ProviderChange, result: string): string {
  const copy = chatCopy.providers
  if (result === 'failed') return copy.failed
  return change._tag === 'custom' && !/^https?:\/\/\S+$/i.test(change.baseUrl) ? copy.invalidUrl : copy.invalidKey
}

/** The agent's model list for the shown provider, once it runs; and whether a custom endpoint wants a typed id. */
function useModels(shown: SetUpChoice, saved: boolean) {
  const result = useAtomValue(junoSettingsAtom)
  const page = result._tag === 'Success' ? result.value : undefined
  if (!saved || page === undefined) return { models: undefined, typed: false, selected: undefined }
  const typed = shown === 'custom' && page.modelTyped === true
  const models = page.chatModels.filter((model) => model.provider === providerOf(shown) && (CODEX_ENABLED || model.provider !== 'codex'))
  const listed = models.length === 0 ? undefined : models
  const pick = listed?.find((model) => model.selected) ?? listed?.find((model) => model.resolved !== undefined)
  return { models: listed, typed, selected: pick === undefined ? undefined : modelChoiceKey(pick) }
}

/**
 * "Set up Juno" (SPEC 13.10), on the sign-in page after a first sign-in:
 * the owner picks a provider, saves its key through main to the keychain
 * (`setAgentProvider`, the path Settings › Juno uses) or signs in to
 * Codex, and chooses the chat model, Sonnet unless changed. Skip for now
 * leaves AI assist on with nothing set up.
 */
export function SetUpJuno() {
  const provider = useAtomValue(agentProviderAtom)
  const [codex, setCodex] = useState<SetUpCodex | undefined>(undefined)
  const [picked, setPicked] = useState<SetUpChoice | undefined>(undefined)
  const [drafts, setDrafts] = useState<ProviderDrafts>(emptyDrafts)
  const [chosenModel, setChosenModel] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<'save' | 'codex' | 'finish' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  useEffect(() => {
    void codexSetup().then(setCodex)
  }, [])
  const shown: SetUpChoice = CODEX_ENABLED ? picked ?? provider?.active ?? (codex === 'signedIn' ? 'codex' : 'openRouter') : picked ?? (provider?.active === 'custom' ? 'custom' : 'openRouter')
  const saved = shown === 'codex' ? codex === 'signedIn' : provider?.active === shown
  const { models, typed, selected } = useModels(shown, saved)
  const model = chosenModel ?? (typed ? '' : selected)

  const save = async () => {
    const change = changeFor(shown, drafts)
    setBusy('save')
    const result = await setAgentProvider(change)
    setBusy(undefined)
    if (result === 'saved') {
      setDrafts(emptyDrafts)
      setError(undefined)
    } else setError(refusal(change, result))
  }
  const finish = async () => {
    const choice = typed ? undefined : models?.find((candidate) => modelChoiceKey(candidate) === model)
    const family = typed ? (model ?? '').trim() : choice?.family
    // Sonnet is chosen already unless the owner picked another; Codex is chosen here, since nothing selects it by default.
    if (family !== undefined && (typed || choice?.selected !== true)) {
      setBusy('finish')
      await actions.settings({ _tag: 'model', purpose: 'chat', provider: choice?.provider ?? 'custom', family })
    }
    leave()
  }
  const signInCodex = async () => {
    setBusy('codex')
    const after = await codexSetup(true)
    setBusy(undefined)
    setCodex(after)
    setError(after === 'signedIn' ? undefined : 'Codex did not finish signing in. Try again.')
  }

  return (
    <SetUpJunoView
      shown={shown}
      {...(codex === undefined ? {} : { codex })}
      drafts={drafts}
      saved={saved}
      {...(models === undefined ? {} : { models })}
      {...(model === undefined ? {} : { model })}
      modelTyped={typed}
      {...(busy === undefined ? {} : { busy })}
      {...(error === undefined ? {} : { error })}
      onShow={(choice) => {
        setPicked(choice)
        setChosenModel(undefined)
        setError(undefined)
      }}
      onDraft={setDrafts}
      onModel={setChosenModel}
      onSignInCodex={() => void signInCodex()}
      onContinue={() => void (saved ? finish() : save())}
      onSkip={leave}
    />
  )
}
