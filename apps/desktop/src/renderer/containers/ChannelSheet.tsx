/**
 * The channel sheet's draft (SPEC 5, "Channel sheet"): the name as Slack
 * will take it, Private for a new channel, and the members, local to the
 * open sheet. The people search is the view sheet's (`newChat.conversations`,
 * local only). Editing asks Slack for the channel's members as it opens.
 *
 * Create waits for Slack: a refusal keeps the sheet open with the reason
 * under the name; success opens the new channel's Main in the current tab.
 * Save closes the sheet and applies the changes (`channelActions.ts`).
 */
import { useDeferredValue, useEffect, useState } from 'react'
import { channelsCreate, channelsMembers, normalizeChannelName, type Person, type PickConversation } from '@juno/contract'
import { errorOf, pickConversationsAtom, registry, runCommand, sessionStatusAtom, showToast, type ChannelSheetState } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { ChannelSheet as ChannelSheetView } from '@juno/views'
import { closeChannelSheet } from './channelActions'
import { channelErrorText, createdText, saveChannel } from './channelSheetActions'
import { openTopic } from './navigation'

const NONE: ReadonlyArray<PickConversation> = []

/** The people among the picker's rows: DMs and people with no DM yet, never the user. */
function peopleOf(list: ReadonlyArray<PickConversation>, selfId: string | undefined): ReadonlyArray<Person> {
  return list.flatMap((pick) => (pick.kind === 'im' && pick.person !== undefined && pick.person.id !== selfId ? [pick.person] : []))
}

/** The code a failed command carries, for `channelErrorText`. */
function codeOf(exit: Parameters<typeof errorOf>[0]): string {
  const error = errorOf(exit) as { readonly _tag: string; readonly code?: string } | undefined
  if (error?._tag === 'Rejected' && error.code !== undefined) return error.code
  return error?._tag === 'RateLimited' ? 'ratelimited' : error?._tag === 'NotSignedIn' ? 'not_authed' : 'offline'
}

/**
 * The members as the sheet shows them: the channel's, as Slack lists them
 * when editing, less the ones removed, then the people added.
 */
function useMembers(sheet: ChannelSheetState, onError: (text: string) => void) {
  const [current, setCurrent] = useState<ReadonlyArray<Person> | undefined>(sheet.mode === 'new' ? [] : undefined)
  const [added, setAdded] = useState<ReadonlyArray<Person>>([])
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const channelId = sheet.mode === 'edit' && sheet.members ? sheet.channelId : undefined
  useEffect(() => {
    if (channelId === undefined) return
    let live = true
    void runCommand(registry, channelsMembers, { channel: channelId }).then((exit) => {
      if (!live) return
      setCurrent(exit._tag === 'Success' ? exit.value : [])
      if (exit._tag === 'Failure') onError(`Couldn’t get the members. ${channelErrorText(codeOf(exit))}`)
    })
    return () => {
      live = false
    }
  }, [channelId, onError])
  const members = [...(current ?? []).filter((person) => !removed.has(person.id)), ...added]
  const isCurrent = (person: Person) => current?.some((each) => each.id === person.id) === true
  const remove = (person: Person) => {
    if (isCurrent(person)) setRemoved((ids) => new Set(ids).add(person.id))
    else setAdded((people) => people.filter((each) => each.id !== person.id))
  }
  const toggle = (person: Person) => {
    if (members.some((each) => each.id === person.id)) return remove(person)
    if (isCurrent(person)) setRemoved((ids) => new Set([...ids].filter((id) => id !== person.id)))
    else setAdded((people) => [...people, person])
  }
  return { members, loading: current === undefined, added: added.map((person) => person.id), removed: [...removed], remove, toggle }
}

export function ChannelSheet({ sheet }: { readonly sheet: ChannelSheetState }) {
  const start = normalizeChannelName(sheet.name)
  const [name, setName] = useState(start.name)
  const [adjusted, setAdjusted] = useState(sheet.mode === 'new' && start.changed && sheet.name !== '')
  const [caret, setCaret] = useState<{ readonly at: number } | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [isPrivate, setPrivate] = useState(false)
  const [busy, setBusy] = useState(false)
  const members = useMembers(sheet, setError)
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const picks = useAtomValue(pickConversationsAtom(deferred))
  const session = useAtomValue(sessionStatusAtom)
  const selfId = session._tag === 'Success' && session.value._tag === 'ready' ? session.value.userId : undefined
  const found = picks._tag === 'Success' ? picks.value : undefined
  const results = peopleOf(found === undefined ? NONE : deferred.trim() === '' ? found.recent : found.people, selfId)

  const onNameChange = (typed: string, at: number) => {
    const next = normalizeChannelName(typed)
    // The caret stays after what was typed before it, as Slack's rules shaped that part.
    setCaret({ at: normalizeChannelName(typed.slice(0, at)).name.length })
    setName(next.name)
    if (next.changed) setAdjusted(true)
    else if (next.name === '') setAdjusted(false)
    setError(undefined)
  }

  const create = async () => {
    setBusy(true)
    setError(undefined)
    const exit = await runCommand(registry, channelsCreate, { name, isPrivate, members: members.added })
    setBusy(false)
    if (exit._tag === 'Failure') return setError(channelErrorText(codeOf(exit)))
    closeChannelSheet()
    openTopic(exit.value.topicId)
    showToast(registry, { text: createdText(exit.value.name, exit.value.notAdded) })
  }

  const submit = () => {
    if (sheet.mode === 'new') return void create()
    void saveChannel({ id: sheet.channelId, name: sheet.name }, { name, add: members.added, remove: members.removed })
  }

  return (
    <ChannelSheetView
      mode={sheet.mode}
      name={name}
      adjusted={adjusted}
      error={error}
      isPrivate={isPrivate}
      members={members.members}
      membersLoading={members.loading}
      query={query}
      results={results}
      busy={busy}
      caret={caret}
      onNameChange={onNameChange}
      onPrivateChange={setPrivate}
      onQueryChange={setQuery}
      onToggle={members.toggle}
      onRemove={members.remove}
      onSubmit={submit}
      onCancel={closeChannelSheet}
      {...(sheet.mode === 'edit' ? { canRename: sheet.rename, canChangeMembers: sheet.members } : {})}
    />
  )
}
