import { memo, useState } from 'react'
import { chatCopy, type JunoPage, type JunoSettingsPage as JunoSettingsPageModel, type PinId } from '@juno/agent-contract'
import { copyText, nowAtom, registry, setOpenRouterKey } from '@juno/state'
import {
  activityPageAtom,
  connectionsPageAtom,
  junoPageActions,
  junoSettingsAtom,
  memoryPageAtom,
  remembersPageAtom,
  reviewPageAtom,
  scheduledPageAtom,
  type JunoSettingsChange,
} from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { ActivityPage, ConnectionsPage, JunoSettingsPage, MemoryPage, noopActions, RemembersPage, ReviewPage, ScheduledPage, type KeyEntry } from '@juno/views'

/** The pages' RPC-backed commands, one set for the app. */
const actions = junoPageActions(registry)

/** Times change at most at a day boundary; re-render for it this often. */
const TIME_STEP = 10 * 60_000
/** Rows Memory and Activity open with, and add for each "Load more"; the agent's page limit is 200. */
const PAGE_ROWS = 50
const PAGE_MAX = 200

const useNow = () => useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)

/**
 * A Juno page in its tab (SPEC 13.10): the page behind the Juno menu, or
 * Settings › Juno, live from the agent. Until its first value arrives the
 * page draws nothing (performance 4.4: no spinner under 300 ms). Commands
 * answer through the page's own stream, so a refusal shows as the page
 * staying as it was.
 */
export const JunoPageTab = memo(function JunoPageTab({ page }: { readonly page: JunoPage }) {
  switch (page) {
    case 'settings':
      return <Settings />
    case 'remembers':
      return <Remembers />
    case 'memory':
      return <Memory />
    case 'activity':
      return <Activity />
    case 'scheduled':
      return <Scheduled />
    case 'connections':
      return <Connections />
    case 'review':
      return <Review />
  }
})

/**
 * Settings › Juno. The models, spend, the OpenRouter key and Pause are
 * served (juno-settings). Codex (WP20), Rules (WP15), Backup and This Mac
 * (WP21) get no callbacks, so the view leaves them out until they are built.
 * The key goes from the field to main's keychain, never through the page.
 */
function Settings() {
  const result = useAtomValue(junoSettingsAtom)
  const now = useNow()
  const [entry, setEntry] = useState<{ readonly draft: string; readonly error?: string } | undefined>(undefined)
  // A change shows at once (performance 1: one frame for direct feedback) and gives way when the agent's page agrees or refuses it.
  const [shown, setShown] = useState<Shown>({})
  const served = result._tag === 'Success' ? result.value : undefined
  const left = served === undefined ? shown : unconfirmed(served, shown)
  if (left !== shown) setShown(left)
  if (served === undefined) return null
  const page = withShown(served, shown)
  const change = (next: Shown, request: JunoSettingsChange) => {
    setShown({ ...shown, ...next })
    void actions.settings(request).then((outcome) => {
      if (outcome !== 'ok') setShown({})
    })
  }
  const providerOf = (purpose: 'chat' | 'compaction', family: string) =>
    (purpose === 'chat' ? page.chatModels : page.compactionModels).find((model) => model.family === family)?.provider ?? 'openrouter'
  const save = async (draft: string) => {
    const saved = await setOpenRouterKey(draft.trim())
    if (saved === 'saved') setEntry(undefined)
    else setEntry({ draft, error: saved === 'invalid' ? chatCopy.pages.settings.keyInvalid : chatCopy.pages.settings.keyFailed })
  }
  const keyEntry: KeyEntry | undefined =
    entry === undefined
      ? undefined
      : {
          draft: entry.draft,
          ...(entry.error === undefined ? {} : { error: entry.error }),
          onDraft: (draft) => setEntry({ draft }),
          onSave: () => void save(entry.draft),
          onCancel: () => setEntry(undefined),
        }
  return (
    <JunoSettingsPage
      page={page}
      now={now}
      onChatModel={(family) => change({ chat: family }, { _tag: 'model', purpose: 'chat', provider: providerOf('chat', family), family })}
      onCompactionModel={(family) => change({ compaction: family }, { _tag: 'model', purpose: 'compaction', provider: providerOf('compaction', family), family })}
      onCap={(usd) => void actions.settings({ _tag: 'cap', usd })}
      onOpenRouterKey={() => setEntry({ draft: '' })}
      {...(keyEntry === undefined ? {} : { keyEntry })}
      onPaused={(value) => change({ paused: value }, { _tag: 'paused', value })}
    />
  )
}

/** Changes the owner just made, shown until the agent's page arrives with them. */
interface Shown {
  readonly paused?: boolean
  readonly chat?: string
  readonly compaction?: string
}

const selectedFamily = (models: JunoSettingsPageModel['chatModels']) => models.find((model) => model.selected)?.family

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
  const pick = (models: JunoSettingsPageModel['chatModels'], family: string | undefined) => (family === undefined ? models : models.map((model) => ({ ...model, selected: model.family === family })))
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

function Connections() {
  const result = useAtomValue(connectionsPageAtom)
  if (result._tag !== 'Success') return null
  // Moving a tool between tiers needs its schema hash from the manager (WP17), which lists no connection yet.
  return (
    <ConnectionsPage
      page={result.value}
      onEnabled={(id, enabled) => void actions.connection(id, enabled ? 'enable' : 'disable')}
      onT3Address={(_id, address) => void actions.t3Address(address)}
      onTier={() => {}}
    />
  )
}

function Review() {
  const result = useAtomValue(reviewPageAtom)
  const now = useNow()
  if (result._tag !== 'Success') return null
  // Activate needs the owner's word that the old Mac is off (WP21); recovery cannot happen before then.
  return <ReviewPage page={result.value.page} now={now} actions={noopActions} onActivate={() => {}} />
}
