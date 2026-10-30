import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { TODAY_DECISIONS_LIMIT, type Instruction, type InstructionRule, type NotificationPermission, type NotificationSettingsView, type NotifyTag, type PickConversation, type TodayRow } from '@juno/contract'
import {
  applyJunoHours,
  checkInstruction,
  getNotificationPermission,
  notificationDecisionsAtom,
  notificationSettingsAtom,
  notificationsPageAtom,
  openNotificationSettings,
  pickConversationsAtom,
  registry,
  removeInstruction,
  requestNotificationPermission,
  saveInstruction,
  sendTestNotification,
  setAlwaysNotify,
  setAwayOutsideHours,
  setGroupHours,
  setHuddleRing,
  showToast,
} from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { NotificationsPage as NotificationsPageView, type Decision, type InstructionDirection, type LevelPicker, type LevelTag, type ListedLevel, type ProposedInstruction } from '@juno/views'
import { openSettings } from './navigation'
import { notificationsAnchorShown, openNotificationsAt, useNotificationsAnchor } from './notificationsAnchor'
import { setNotifyLevel } from './notifyActions'

/** How a toast names a tag: "#incidents", "Maya Chen". */
function tagLabel(tag: LevelTag): string {
  return tag.kind === 'channel' && (tag.channelKind === 'public' || tag.channelKind === 'private') ? `#${tag.name}` : tag.name
}

/** A tag's x: back to Auto, with Undo. */
function removeLevel(tag: LevelTag): void {
  setNotifyLevel({ kind: tag.kind, id: tag.id }, 'auto', tagLabel(tag))
}

/** A pick from Add…: a person by their user id, a channel, DM or group DM by its id. */
function pickLevel(level: ListedLevel, conversation: PickConversation): void {
  const named = conversation.kind === 'public' || conversation.kind === 'private' ? `#${conversation.name}` : conversation.name
  if (conversation.kind === 'im' && conversation.person !== undefined) return setNotifyLevel({ kind: 'person', id: conversation.person.id }, level, named)
  if (conversation.channelId !== undefined) setNotifyLevel({ kind: 'channel', id: conversation.channelId }, level, named)
}

/** Remove, with Undo that saves it again. */
function remove(settings: NotificationSettingsView, id: string): void {
  const instruction = settings.instructions.find((each) => each.id === id)
  removeInstruction(registry, id)
  if (instruction === undefined) return
  showToast(registry, {
    text: 'Instruction removed',
    onUndo: async () => (await saveInstruction(registry, { direction: instruction.direction, text: instruction.text })) !== undefined,
  })
}

const asTag = (tag: NotifyTag): LevelTag => tag

/** A day's decision as Details shows it. A DM's place is its sender, so it is left out. */
function asDecision(row: TodayRow): Decision {
  return {
    id: String(row.id),
    at: row.at,
    sender: row.sender,
    senderId: row.senderId,
    place: row.place === row.sender ? '' : row.place,
    text: row.text,
    notified: row.outcome === 'notify',
    decidedBy: row.decidedBy,
    reason: row.reason,
  }
}

const firstName = (name: string) => name.split(' ')[0] ?? name
const isDm = (row: TodayRow) => row.channelId.startsWith('D')

/** The first words of a message, for a proposed instruction. */
function opening(text: string): string {
  const words = text.trim().split(/\s+/)
  return words.length <= 6 ? words.join(' ') : `${words.slice(0, 6).join(' ')}…`
}

/**
 * What Should have notified or Shouldn't have notified proposes, built from
 * the place and the message, never generated: the owner edits it in the
 * list afterwards.
 */
function proposalFor(row: TodayRow): ProposedInstruction {
  const where = isDm(row) ? `from ${firstName(row.sender)}` : `in ${row.place.split(' · ')[0] ?? row.place}`
  return row.outcome === 'notify' ? { direction: 'stay', text: `Updates ${where} with nothing asked of me` } : { direction: 'notify', text: `Messages ${where} like "${opening(row.text)}"` }
}

/** The last answer, so the page opens again with it and nothing moves while main answers. */
let lastPermission: NotificationPermission | undefined

/**
 * Whether macOS lets Juno notify, asked when the page opens and again each
 * time the window regains focus, so the line goes once the owner turns
 * notifications on in System Settings and comes back.
 */
function useNotificationPermission(): readonly [NotificationPermission | undefined, () => void] {
  const [permission, setPermission] = useState(lastPermission)
  useEffect(() => {
    let live = true
    const read = () =>
      void getNotificationPermission().then((next) => {
        lastPermission = next
        if (live) setPermission(next)
      })
    read()
    window.addEventListener('focus', read)
    return () => {
      live = false
      window.removeEventListener('focus', read)
    }
  }, [])
  // macOS shows its prompt once. When it does not (an unsigned build), System Settings is the way left.
  const allow = () =>
    void requestNotificationPermission().then((next) => {
      lastPermission = next
      setPermission(next)
      if (next.authorization === 'notDetermined') openNotificationSettings()
    })
  return [permission, allow]
}

/** Change opens the part of the page, or the place in Settings, that decided. */
function changeSetting(decision: Decision): void {
  switch (decision.decidedBy) {
    case 'hours':
      return openNotificationsAt('hours')
    case 'alwaysNotify':
      return openNotificationsAt('always-notify')
    case 'ignored':
      return openSettings('ignored')
    default:
      return openNotificationsAt('levels')
  }
}

type RuleChecks = ReadonlyMap<string, InstructionRule | undefined>

/** One edit after another per instruction, each on the id the last save answered with: a changed instruction gets a new id. */
const edits = new Map<string, Promise<Instruction | undefined>>()

function editInstruction(saved: Instruction | undefined, id: string, change: { readonly direction?: InstructionDirection; readonly text?: string }): void {
  const next = (edits.get(id) ?? Promise.resolve(saved)).then(async (base) => {
    if (base === undefined) return undefined
    const wanted = { direction: change.direction ?? base.direction, text: change.text ?? base.text }
    const newId = await saveInstruction(registry, { id: base.id, ...wanted })
    return newId === undefined ? base : { id: newId, ...wanted }
  })
  edits.set(id, next)
  // The row shows the new id once the settings arrive; an edit made then joins the same chain.
  void next.then((result) => result === undefined || edits.set(result.id, next))
}

/** Your instructions' props: the list, each added instruction's rule check, and the edits. */
function instructionActions(current: NotificationSettingsView, ruleChecks: RuleChecks, setRuleChecks: Dispatch<SetStateAction<RuleChecks>>) {
  const without = (id: string) => setRuleChecks((shown) => {
    const next = new Map(shown)
    next.delete(id)
    return next
  })
  const add = async (direction: InstructionDirection, text: string) => {
    const id = await saveInstruction(registry, { direction, text })
    // The check is a chat-model call: only with AI assist on, once for this instruction.
    if (id === undefined || !current.aiAssist) return
    setRuleChecks((shown) => new Map(shown).set(id, undefined))
    const rule = await checkInstruction(registry, text, direction)
    if (rule === undefined) without(id)
    else setRuleChecks((shown) => (shown.has(id) ? new Map(shown).set(id, rule) : shown))
  }
  const makeSetting = (instructionId: string) => {
    const rule = ruleChecks.get(instructionId)
    without(instructionId)
    if (rule === undefined) return
    removeInstruction(registry, instructionId)
    setNotifyLevel({ kind: rule.kind, id: rule.id }, rule.level, rule.name)
  }
  return {
    instructions: current.instructions,
    ruleChecks: new Map([...ruleChecks].map(([id, rule]) => [id, rule === undefined ? undefined : { name: rule.name, level: rule.level }] as const)),
    onAdd: (direction: InstructionDirection, text: string) => void add(direction, text),
    onEdit: (id: string, change: { readonly direction?: InstructionDirection; readonly text?: string }) => editInstruction(current.instructions.find((each) => each.id === id), id, change),
    onRemove: (id: string) => remove(current, id),
    onMakeSetting: makeSetting,
    onKeepInstruction: without,
  }
}

/** The instructions Should have notified proposed, by decision id. Add it and Just this time both end one, so it does not come back. */
function useProposals() {
  const [shown, setShown] = useState<ReadonlyMap<string, ProposedInstruction>>(new Map())
  const add = (id: string, proposal: ProposedInstruction) => setShown((current) => new Map(current).set(id, proposal))
  const drop = (decision: Decision) =>
    setShown((current) => {
      const next = new Map(current)
      next.delete(decision.id)
      return next
    })
  return { shown, add, drop }
}

/** Add…'s searchable list: the rows are asked for only while it is open. */
function useLevelPicker(): LevelPicker {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const conversations = useAtomValue(pickConversationsAtom(open ? query : undefined))
  return { query, onQuery: setQuery, conversations: conversations._tag === 'Success' ? conversations.value : undefined, loading: conversations._tag !== 'Success', onOpenChange: setOpen }
}

/** What Details needs beyond its rows: the proposals, Always for a DM on Auto, and each action. */
function whyProps(current: NotificationSettingsView, rows: ReadonlyArray<TodayRow> | undefined, proposals: ReturnType<typeof useProposals>) {
  const rowOf = (decision: Decision) => rows?.find((row) => String(row.id) === decision.id)
  return {
    proposals: proposals.shown,
    // A DM on Auto offers Always for its person.
    alwaysFor: new Map((rows ?? []).filter((row) => isDm(row) && current.people[row.senderId] === undefined && current.channels[row.channelId] === undefined).map((row) => [String(row.id), firstName(row.sender)] as const)),
    onChange: changeSetting,
    onEditInstructions: () => openNotificationsAt('instructions'),
    onSuggest: (decision: Decision) => {
      const row = rowOf(decision)
      if (row !== undefined) proposals.add(decision.id, proposalFor(row))
    },
    onAddInstruction: (decision: Decision, instruction: ProposedInstruction) => {
      proposals.drop(decision)
      void saveInstruction(registry, instruction).then((id) => id !== undefined && showToast(registry, { text: 'Instruction added' }))
    },
    onDismissSuggestion: proposals.drop,
    onAlways: (decision: Decision) => setNotifyLevel({ kind: 'person', id: decision.senderId }, 'always', decision.sender),
    onSettings: () => openNotificationsAt('how-auto'),
  }
}

/**
 * The Notifications page (SPEC 14): the settings, the page's lists and
 * counts from the engine, today's decisions while Details is open, and
 * macOS's permission from main. Nothing shows until the settings, the page
 * and the permission arrive, which are local and come at once.
 */
export function NotificationsPage() {
  const settings = useAtomValue(notificationSettingsAtom)
  const page = useAtomValue(notificationsPageAtom)
  const [permission, allow] = useNotificationPermission()
  const anchor = useNotificationsAnchor()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const decisions = useAtomValue(notificationDecisionsAtom(detailsOpen))
  const picker = useLevelPicker()
  const [ruleChecks, setRuleChecks] = useState<RuleChecks>(new Map())
  const proposals = useProposals()
  const shownKey = settings._tag === 'Success' && page._tag === 'Success' && permission !== undefined ? anchor?.key : undefined
  // After the page has scrolled there in its layout effect.
  useEffect(() => {
    if (shownKey !== undefined) notificationsAnchorShown(shownKey)
  }, [shownKey])
  // All three are local and come at once; waiting for the page keeps Slack's line from appearing late.
  if (settings._tag !== 'Success' || page._tag !== 'Success' || permission === undefined) return null
  const current = settings.value
  const instructionProps = instructionActions(current, ruleChecks, setRuleChecks)
  const lists = page.value
  const rows = decisions._tag === 'Success' ? decisions.value.decisions : undefined
  return (
    <NotificationsPageView
      notificationHours={current.notificationHours}
      presenceHours={current.presenceHours}
      awayOutsideHours={current.awayOutsideHours}
      onAwayOutsideHoursChange={(enabled) => setAwayOutsideHours(registry, enabled)}
      onHoursChange={(which, group, hours) => setGroupHours(registry, which, group, hours)}
      slackSchedule={lists.slackSchedule}
      onUseJunoHours={() => applyJunoHours(registry)}
      aiAssist={current.aiAssist}
      alwaysNotify={current.alwaysNotify}
      onAlwaysNotifyChange={(which, enabled) => setAlwaysNotify(registry, which, enabled)}
      {...instructionProps}
      always={lists.always.map(asTag)}
      never={lists.never.map(asTag)}
      onRemoveLevel={removeLevel}
      picker={picker}
      onPickLevel={pickLevel}
      onOpenIgnored={() => openSettings('ignored')}
      notifiedToday={lists.notified}
      stayedToday={lists.stayed}
      decisions={rows?.map(asDecision)}
      capped={rows !== undefined && rows.length >= TODAY_DECISIONS_LIMIT && rows.length < lists.notified + lists.stayed}
      onDetailsOpenChange={setDetailsOpen}
      {...whyProps(current, rows, proposals)}
      huddleRing={current.huddleRing}
      onHuddleRingChange={(enabled) => setHuddleRing(registry, enabled)}
      permission={permission}
      onSendTest={sendTestNotification}
      onOpenSettings={openNotificationSettings}
      onAllow={allow}
      {...(anchor === undefined ? {} : { anchor: anchor.anchor, anchorKey: anchor.key })}
    />
  )
}
