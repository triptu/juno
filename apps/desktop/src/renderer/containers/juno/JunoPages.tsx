import { memo, useState } from 'react'
import { chatCopy, modelChoiceKey, type ConnectionId, type JunoSettingsPage as JunoSettingsPageModel, type PinId } from '@juno/agent-contract'
import type { ProviderChange, ProviderKind } from '@juno/contract'
import { copyText, nowAtom, registry, type JunoTabPage } from '@juno/state'
import {
  activityPageAtom,
  agentProviderAtom,
  connectionsPageAtom,
  junoPageActions,
  junoSettingsAtom,
  memoryPageAtom,
  remembersPageAtom,
  reviewPageAtom,
  scheduledPageAtom,
  setAgentProvider,
  type JunoSettingsChange,
} from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { ActivityPage, ConnectionsPage, JunoBackupPage, JunoSettingsPage, MemoryPage, noopActions, ProviderSection, RemembersPage, ReviewPage, ScheduledPage, type ChatActions, type ProviderDrafts } from '@juno/views'
import { openSettings } from '../navigation'
import { junoCommands, openJunoTab } from './actions'
import { useBackupSettings } from './BackupSettings'
import { ConnectionConfigure } from './ConnectionConfigure'
import { useNoProvider } from './NoProviderFrame'

/** The pages' RPC-backed commands, one set for the app. */
const actions = junoPageActions(registry)

/** Times change at most at a day boundary; re-render for it this often. */
const TIME_STEP = 10 * 60_000
/** Rows Memory and Activity open with, and add for each "Load more"; the agent's page limit is 200. */
const PAGE_ROWS = 50
const PAGE_MAX = 200

const useNow = () => useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)

/**
 * A Juno page in its tab (SPEC 13.10): a page behind the Juno menu, live
 * from the agent. Until its first value arrives the page draws nothing
 * (performance 4.4: no spinner under 300 ms). Commands answer through the
 * page's own stream, so a refusal shows as the page staying as it was.
 * Settings › Juno, Connections and Backup & This Mac are sections of
 * Settings (`JunoSettings`, `JunoConnections`, `JunoBackup`).
 */
export const JunoPageTab = memo(function JunoPageTab({ page }: { readonly page: JunoTabPage }) {
  switch (page) {
    case 'remembers':
      return <Remembers />
    case 'memory':
      return <Memory />
    case 'activity':
      return <Activity />
    case 'scheduled':
      return <Scheduled />
    case 'review':
      return <Review />
  }
})

/**
 * Settings › Juno. The provider comes from main (juno-providers); the models,
 * spend, Pause (juno-settings) and the owner's rules (WP15) from the agent.
 * Codex's sign-in (WP20) gets no callback, so the view leaves it out until
 * it is built. The key goes from the field to main's keychain, never
 * through the page.
 */
export function JunoSettings() {
  const result = useAtomValue(junoSettingsAtom)
  // A change shows at once (performance 1: one frame for direct feedback) and gives way when the agent's page agrees or refuses it.
  const [shown, setShown] = useState<Shown>({})
  // The rules list while the owner edits it, saved as a whole.
  const [rules, setRules] = useState<ReadonlyArray<Rule> | undefined>(undefined)
  const [rulesError, setRulesError] = useState<string | undefined>(undefined)
  const served = result._tag === 'Success' ? result.value : undefined
  const left = served === undefined ? shown : unconfirmed(served, shown)
  if (left !== shown) setShown(left)
  // The saved list gives way to the agent's once the page shows it.
  if (served !== undefined && rules !== undefined && rulesError === undefined && sameRules(served.rules, rules)) setRules(undefined)
  const providers = <Providers rejected={served?.openRouterKey === 'rejected' || served?.customKeyRejected === true} />
  // No agent runs until a provider is set up, and none answers until it starts: the provider section alone.
  if (served === undefined) return <JunoSettingsPage providers={providers} onChatModel={noop} onCompactionModel={noop} onCap={noop} onPaused={noop} />
  const shownPage = withShown(served, shown)
  const page = rules === undefined ? shownPage : { ...shownPage, rules }
  // The rules are saved as a whole list when a field loses focus; empty rows are dropped, as the agent takes no empty rule.
  const commitRules = (next: ReadonlyArray<Rule> | undefined = rules) => {
    if (next === undefined) return
    const kept = next.filter((rule) => rule.text.trim() !== '')
    void actions.settings({ _tag: 'rules', rules: kept }).then((outcome) => {
      if (outcome === 'ok') {
        setRules(kept)
        setRulesError(undefined)
      } else setRulesError(chatCopy.pages.settings.rulesInvalid)
    })
  }
  const change = (next: Shown, request: JunoSettingsChange) => {
    setShown({ ...shown, ...next })
    void actions.settings(request).then((outcome) => {
      if (outcome !== 'ok') setShown({})
    })
  }
  // On a custom endpoint the chat model is an id, listed or typed; on OpenRouter a family.
  const provider = page.provider === 'custom' ? 'custom' : 'openrouter'
  return (
    <JunoSettingsPage
      page={page}
      providers={providers}
      onChatModel={(key) => {
        const choice = page.chatModels.find(model => modelChoiceKey(model) === key)
        change({ chat: key }, { _tag: 'model', purpose: 'chat', provider: choice?.provider ?? provider, family: choice?.family ?? key })
      }}
      onCompactionModel={(family) => change({ compaction: family }, { _tag: 'model', purpose: 'compaction', provider, family })}
      onCap={(usd) => void actions.settings({ _tag: 'cap', usd })}
      onPaused={(value) => change({ paused: value }, { _tag: 'paused', value })}
      onRuleChange={(id, text) => setRules(page.rules.map((rule) => (rule.id === id ? { id, text } : rule)))}
      onRuleAdd={() => setRules([...page.rules, { id: crypto.randomUUID(), text: '' }])}
      onRuleRemove={(id) => {
        const next = page.rules.filter((rule) => rule.id !== id)
        setRules(next)
        commitRules(next)
      }}
      onRulesCommit={() => commitRules()}
      {...(rulesError === undefined ? {} : { rulesError })}
    />
  )
}

/**
 * Settings › Backup & This Mac (WP21, `BackupSettings.tsx`), from the
 * agent's settings page. With no provider no agent runs, and the page
 * points to Settings › Juno; while the agent starts it draws nothing.
 */
export function JunoBackup() {
  const result = useAtomValue(junoSettingsAtom)
  const now = useNow()
  const backup = useBackupSettings()
  const noProvider = useNoProvider()
  if (result._tag !== 'Success') return noProvider ? <JunoBackupPage now={now} {...backup.props} onAddProvider={() => openSettings('juno')} /> : null
  return (
    <>
      <JunoBackupPage page={result.value} now={now} {...backup.props} onAddProvider={() => openSettings('juno')} />
      {backup.sheet}
    </>
  )
}

const noop = () => {}

const emptyDrafts: ProviderDrafts = { openRouterKey: '', baseUrl: '', customKey: '' }

/**
 * The provider section (SPEC 13.10), from main's provider state: OpenRouter
 * or one OpenAI-compatible endpoint. Picking one that is set up switches to
 * it; saving one sets it up and makes it active. Keys go to main and the
 * keychain, never through the agent. The base URL field starts from the
 * stored one.
 */
function Providers({ rejected }: { readonly rejected: boolean }) {
  const state = useAtomValue(agentProviderAtom)
  const [picked, setPicked] = useState<ProviderKind | undefined>(undefined)
  const [drafts, setDrafts] = useState<ProviderDrafts>(emptyDrafts)
  const [urlTouched, setUrlTouched] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  if (state === undefined) return null
  const shown = picked ?? state.active ?? 'openRouter'
  const shownDrafts = urlTouched ? drafts : { ...drafts, baseUrl: state.custom.baseUrl }
  const usable = (kind: ProviderKind) => (kind === 'openRouter' ? state.openRouter.key === 'set' : state.custom.baseUrl !== '')
  const apply = async (change: ProviderChange) => {
    const result = await setAgentProvider(change)
    if (result === 'saved' || result === 'removed') {
      setDrafts(emptyDrafts)
      setUrlTouched(false)
      setError(undefined)
      return
    }
    const copy = chatCopy.providers
    const badUrl = change._tag === 'custom' && !/^https?:\/\/\S+$/i.test(change.baseUrl.trim())
    setError(result === 'failed' ? copy.failed : badUrl ? copy.invalidUrl : copy.invalidKey)
  }
  return (
    <ProviderSection
      state={state}
      shown={shown}
      drafts={shownDrafts}
      {...(error === undefined ? {} : { error })}
      rejected={rejected}
      // "Add a provider" and the Juno menu land here; with nothing set up, the key field takes focus.
      focusFirst={state.active === null}
      onShow={(kind) => {
        setPicked(kind)
        setError(undefined)
        if (usable(kind) && state.active !== kind) void apply({ _tag: 'use', provider: kind })
      }}
      onDraft={(next) => {
        if (next.baseUrl !== shownDrafts.baseUrl) setUrlTouched(true)
        setDrafts(next)
      }}
      onSave={() =>
        void apply(
          shown === 'openRouter'
            ? { _tag: 'openRouter', key: shownDrafts.openRouterKey.trim() }
            : { _tag: 'custom', baseUrl: shownDrafts.baseUrl.trim(), ...(shownDrafts.customKey.trim() === '' ? {} : { key: shownDrafts.customKey.trim() }) },
        )
      }
      onRemove={() => void apply(shown === 'openRouter' ? { _tag: 'openRouter', key: null } : { _tag: 'custom', baseUrl: '' })}
    />
  )
}

type Rule = { readonly id: string; readonly text: string }

const sameRules = (a: ReadonlyArray<Rule>, b: ReadonlyArray<Rule>) => a.length === b.length && a.every((rule, i) => rule.id === b[i]!.id && rule.text === b[i]!.text)

/** Changes the owner just made, shown until the agent's page arrives with them. */
interface Shown {
  readonly paused?: boolean
  readonly chat?: string
  readonly compaction?: string
}

const selectedFamily = (models: JunoSettingsPageModel['chatModels']) => {
  const selected = models.find(model => model.selected)
  return selected === undefined ? undefined : modelChoiceKey(selected)
}

/** The changes the agent's page does not show yet; the same object when nothing was confirmed. */
function unconfirmed(page: JunoSettingsPageModel, shown: Shown): Shown {
  const paused = shown.paused !== undefined && shown.paused === page.paused
  const chat = shown.chat !== undefined && shown.chat === selectedFamily(page.chatModels)
  const compaction = shown.compaction !== undefined && shown.compaction === selectedFamily(page.compactionModels)
  if (!paused && !chat && !compaction) return shown
  return {
    ...(paused || shown.paused === undefined ? {} : { paused: shown.paused }),
    ...(chat || shown.chat === undefined ? {} : { chat: shown.chat }),
    ...(compaction || shown.compaction === undefined ? {} : { compaction: shown.compaction }),
  }
}

function withShown(page: JunoSettingsPageModel, shown: Shown): JunoSettingsPageModel {
  const pick = (models: JunoSettingsPageModel['chatModels'], family: string | undefined) => (family === undefined ? models : models.map((model) => ({ ...model, selected: modelChoiceKey(model) === family })))
  return {
    ...page,
    ...(shown.paused === undefined ? {} : { paused: shown.paused }),
    chatModels: pick(page.chatModels, shown.chat),
    compactionModels: pick(page.compactionModels, shown.compaction),
  }
}

function Remembers() {
  const result = useAtomValue(remembersPageAtom)
  const now = useNow()
  const [editing, setEditing] = useState<{ readonly id: PinId; readonly draft: string } | undefined>(undefined)
  if (result._tag !== 'Success') return null
  const { page, revisions } = result.value
  const revisionOf = (id: PinId) => revisions.find((entry) => entry.id === id)?.revision ?? 0
  return (
    <RemembersPage
      page={page}
      now={now}
      {...(editing === undefined ? {} : { editing })}
      onEditStart={(id) => setEditing({ id, draft: page.pins.find((pin) => pin.id === id)?.text ?? '' })}
      onDraftChange={(draft) => setEditing((current) => (current === undefined ? current : { ...current, draft }))}
      onSave={() => {
        if (editing === undefined) return
        void actions.editPin(editing.id, revisionOf(editing.id), editing.draft).then((outcome) => {
          // A stale edit stays open: the page marks the pin "This changed. Check it and save again."
          if (outcome === 'ok') setEditing(undefined)
        })
      }}
      onCancel={() => setEditing(undefined)}
      onRemove={(id) => void actions.removePin(id, revisionOf(id))}
    />
  )
}

function Memory() {
  const result = useAtomValue(memoryPageAtom(PAGE_MAX))
  const now = useNow()
  return result._tag === 'Success' ? <MemoryPage page={result.value} now={now} /> : null
}

function Activity() {
  const [rows, setRows] = useState(PAGE_ROWS)
  const result = useAtomValue(activityPageAtom(rows))
  const now = useNow()
  // The larger window's first value replaces the smaller one's: the rows shown stay until it arrives.
  const [held, setHeld] = useState(result._tag === 'Success' ? result.value : undefined)
  if (result._tag === 'Success' && result.value !== held) setHeld(result.value)
  const page = result._tag === 'Success' ? result.value : held
  if (page === undefined) return null
  return (
    <ActivityPage
      page={page}
      now={now}
      onCopyDetails={copyText}
      {...(page.moreAbove && rows < PAGE_MAX ? { onLoadMore: () => setRows((n) => Math.min(n + PAGE_ROWS, PAGE_MAX)) } : {})}
    />
  )
}

function Scheduled() {
  const result = useAtomValue(scheduledPageAtom)
  const now = useNow()
  if (result._tag !== 'Success') return null
  const { page, revisions } = result.value
  const act = (action: 'pause' | 'resume' | 'delete') => (id: (typeof revisions)[number]['id']) =>
    void actions.schedule(id, revisions.find((entry) => entry.id === id)?.revision ?? 0, action)
  // Edit opens the schedule's sheet, which comes with WP19 with the schedules themselves.
  return <ScheduledPage page={page} now={now} onPause={act('pause')} onResume={act('resume')} onEdit={() => {}} onDelete={act('delete')} />
}

export function JunoConnections() {
  const result = useAtomValue(connectionsPageAtom)
  const [error, setError] = useState<{ readonly id: ConnectionId | 'new'; readonly message: string } | undefined>(undefined)
  const [configuring, setConfiguring] = useState<ConnectionId | undefined>(undefined)
  if (result._tag !== 'Success') return null
  const page = result.value
  const copy = chatCopy.pages.connections
  // An address the agent refused says so; anything else is one plain line.
  const report = (id: ConnectionId | 'new') => (outcome: string) =>
    setError(outcome === 'ok' ? undefined : { id, message: outcome === 'invalid' && (id === 'new' || page.connections.some((row) => row.id === id && row.t3 !== undefined)) ? copy.invalidAddress : copy.failed })
  return (
    <>
      <ConnectionsPage
        page={page}
        {...(error === undefined ? {} : { error })}
        onAction={(id, action) => {
          setError(undefined)
          void actions.connection(id, action).then(report(id))
        }}
        onConfigure={setConfiguring}
        onAdd={(label, url) => void actions.addConnection(label, url).then(report('new'))}
      />
      {configuring === undefined ? null : <ConnectionConfigure id={configuring} onClose={() => setConfiguring(undefined)} />}
    </>
  )
}

/** The Review page's cards take the chat's card commands: an approval waits until Activate. */
const reviewActions: ChatActions = { ...noopActions, onCard: (id, command) => void junoCommands.onCard(id, command) }

function Review() {
  const result = useAtomValue(reviewPageAtom)
  const now = useNow()
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  if (result._tag !== 'Success') return null
  const { page } = result.value
  const activate = async (backupAt: number) => {
    setActivating(true)
    setError(undefined)
    const answer = await actions.activate(backupAt)
    setActivating(false)
    if (answer.outcome === 'ok') openJunoTab()
    else setError('message' in answer && answer.message !== undefined ? answer.message : 'That did not work. Try again.')
  }
  return (
    <ReviewPage
      page={page}
      now={now}
      actions={reviewActions}
      activating={activating}
      {...(error === undefined ? {} : { error })}
      // Activate names the restore the owner reviewed here.
      onActivate={() => page.backupAt !== undefined && void activate(page.backupAt)}
    />
  )
}
