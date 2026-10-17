import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import {
  defaultPersonColor,
  GROUP_SUGGESTION_LIMIT,
  insertMention,
  mentionQueryAt,
  mentionTokens,
  rankSuggestions,
  removeTokenBefore,
  type MentionChannel,
  type MentionGroup,
  type MentionPerson,
  type MentionPick,
  type MentionQuery,
  type MentionToken,
} from '@juno/contract'
import { mentionChannelsAtom, mentionGroupsAtom, mentionPeopleAtom, onFirstMentionAnswer, type MentionPlace } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { hueFor, mentionRowId, type ComposerMention } from '@juno/views'

import { editField, listKey } from './suggestionKeys'
import { useEmojiSuggestions } from './emojiSuggestions'
import { SuggestionList, useSuggestionList } from './suggestionList'

type Rows =
  | { readonly kind: 'person'; readonly rows: ReadonlyArray<MentionPerson>; readonly groups: ReadonlyArray<MentionGroup> }
  | { readonly kind: 'channel'; readonly rows: ReadonlyArray<MentionChannel> }

/** The list's rows in order, each as the pick it inserts. */
const picksOf = (rows: Rows | undefined): ReadonlyArray<MentionPick> =>
  rows === undefined
    ? []
    : rows.kind === 'person'
      ? [...rows.rows.map((person): MentionPick => ({ kind: 'person', id: person.id, name: person.name })), ...rows.groups.map((group): MentionPick => ({ kind: 'group', id: group.id, name: group.handle }))]
      : rows.rows.map((channel): MentionPick => ({ kind: 'channel', id: channel.id, name: channel.name }))

export interface MentionsOptions {
  readonly text: string
  /** The people and channels picked so far; the owner keeps them with the draft. */
  readonly picks: ReadonlyArray<MentionPick>
  readonly onPicks: (picks: ReadonlyArray<MentionPick>) => void
  /** The owner's change handler, which the returned `onChange` calls. */
  readonly onChange: (value: string) => void
  readonly field: RefObject<HTMLTextAreaElement | null>
  /** The conversation the composer writes to, which ranks the people. */
  readonly place: MentionPlace
  /** Offer user groups after the people (the topic composer). */
  readonly groups?: boolean
}

/**
 * @ and # suggestions for a composer (spec section 8, inventory 7.1). The
 * owner keeps the text and the picks; this follows the caret, asks the
 * engine for matches (`mentions.people`, with `groups` `mentions.groups`,
 * and `mentions.channels`), and answers
 * the `Composer` props that draw the picked names as chips and the list
 * above the field.
 *
 * Each keystroke narrows the last answer at once (`rankSuggestions` on the
 * rows already here), and the engine's answer for the new query replaces
 * it when it lands, so the list never empties or waits while typing.
 * Picks and Backspace edit the field through `insertText` and `delete`, so
 * ⌘Z undoes them like typing.
 */
export function useMentions({ text, picks, onPicks, onChange, field, place, groups = false }: MentionsOptions) {
  const emoji = useEmojiSuggestions({ text, onChange, field })
  const listId = useId()
  const [caret, setCaret] = useState(text.length)
  // Esc closed the list for the query starting here; typing a new "@" opens it again.
  const [dismissed, setDismissed] = useState<number | undefined>(undefined)
  const [chosen, setChosen] = useState<string | undefined>(undefined)

  const tokens = mentionTokens(text, picks)
  const typed = mentionQueryAt(text, Math.min(caret, text.length), tokens)
  const query = typed !== undefined && typed.start !== dismissed ? typed : undefined
  const { rows, answered } = useMentionRows(query, place, groups)
  const listed = picksOf(rows)
  const ids = listed.map((row) => mentionRowId(listId, row.id))
  const activeId = chosen !== undefined && ids.includes(chosen) ? chosen : ids[0]
  const open = query !== undefined && listed.length > 0
  const listReady = useSuggestionList(query !== undefined)

  /** Puts `picked` in place of the query `at`, and keeps it with the picks. */
  const insertPick = (at: MentionQuery, picked: MentionPick) => {
    if (!picks.some((p) => p.kind === picked.kind && p.id === picked.id && p.name === picked.name)) onPicks([...picks, picked])
    const after = insertMention(text, at, picked)
    // Only what changes is typed: the name, and the space when there is none yet.
    editField(field.current, at.start, at.end, after.text.slice(at.start, after.caret))
  }
  const pick = (rowId: string) => {
    const row = listed[ids.indexOf(rowId)]
    if (query === undefined || row === undefined) return
    insertPick(query, row)
    setChosen(undefined)
  }
  const held = useHeldEnter(place, (at, first) => {
    // Typing went on meanwhile: that text decides, not this answer.
    if (field.current?.value === text) insertPick(at, { kind: at.trigger === '@' ? 'person' : 'channel', id: first.id, name: first.name })
  })

  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false
    if (open && activeId !== undefined) {
      const handled = listKey(event, ids, activeId, { move: setChosen, pick, close: () => setDismissed(query?.start) })
      if (handled) return true
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && query !== undefined && !answered) {
      event.preventDefault()
      held.hold(query)
      return true
    }
    if (event.key !== 'Backspace' || event.shiftKey) return false
    const element = event.currentTarget
    const removed = element.selectionStart === element.selectionEnd ? removeTokenBefore(text, element.selectionStart, tokens) : undefined
    if (removed === undefined) return false
    event.preventDefault()
    const token = tokens.find((t) => t.start === removed.caret)
    if (token !== undefined) editField(element, token.start, token.end, '')
    return true
  }

  return {
    onChange: (value: string, at: number) => {
      setCaret(at)
      held.drop()
      // A new query, or none: Esc's choice was for the one before.
      if (dismissed !== undefined && mentionQueryAt(value, at, mentionTokens(value, picks))?.start !== dismissed) setDismissed(undefined)
      emoji.onChange(value, at)
    },
    onCaret: (at: number) => { setCaret(at); emoji.onCaret(at) },
    onFieldKey: (event: KeyboardEvent<HTMLTextAreaElement>) => emoji.onFieldKey(event) || onFieldKey(event),
    marks: marksOf(tokens),
    ...(typed === undefined
      ? emoji.mention === undefined ? {} : { mention: emoji.mention }
      : {
          mention: {
            anchorAt: typed.start,
            listId,
            activeId: open ? activeId : undefined,
            list: open && rows !== undefined && listReady ? <SuggestionList {...rows} id={listId} activeId={activeId} onActivate={setChosen} onPick={pick} /> : null,
            onDismiss: () => setDismissed(typed.start),
          } satisfies ComposerMention,
        }),
  }
}

/**
 * The rows for `query`: the engine's answer once it is here, and until then
 * the last answer narrowed to the query. `answered` is false while the
 * answer for this query is on its way.
 */
function useMentionRows(query: MentionQuery | undefined, place: MentionPlace, withGroups: boolean): { readonly rows: Rows | undefined; readonly answered: boolean } {
  const people = useAtomValue(mentionPeopleAtom(query?.trigger === '@' ? query.text : undefined, place))
  // Groups only once something is typed after the "@"; the people and the groups answer together, so the list grows once.
  const groupQuery = withGroups && query?.trigger === '@' && query.text.trim() !== '' ? query.text : undefined
  const groups = useAtomValue(mentionGroupsAtom(groupQuery))
  const channels = useAtomValue(mentionChannelsAtom(query?.trigger === '#' ? query.text : undefined))
  // Kept as state: a new answer replaces it during render.
  const [last, setLast] = useState<Rows | undefined>(undefined)
  if (query === undefined) return { rows: undefined, answered: false }
  const fresh: Rows | undefined =
    query.trigger === '@'
      ? people._tag === 'Success' && (groupQuery === undefined || groups._tag === 'Success')
        ? { kind: 'person', rows: people.value, groups: groupQuery === undefined || groups._tag !== 'Success' ? [] : groups.value }
        : undefined
      : channels._tag === 'Success'
        ? { kind: 'channel', rows: channels.value }
        : undefined
  if (fresh !== undefined) {
    if (fresh.rows !== last?.rows || (fresh.kind === 'person' && last?.kind === 'person' && fresh.groups !== last.groups)) setLast(fresh)
    return { rows: fresh, answered: true }
  }
  if (last?.kind === 'person' && query.trigger === '@') {
    const narrowed = groupQuery === undefined ? [] : rankSuggestions(last.groups, query.text, GROUP_SUGGESTION_LIMIT)
    return { rows: { kind: 'person', rows: rankSuggestions(last.rows, query.text), groups: narrowed }, answered: false }
  }
  if (last?.kind === 'channel' && query.trigger === '#') return { rows: { kind: 'channel', rows: rankSuggestions(last.rows, query.text) }, answered: false }
  return { rows: undefined, answered: false }
}

/**
 * Enter or Tab before the engine answered a query the narrowed list had
 * nothing for: the first row of the answer goes in when it lands, so
 * "#pla" and a quick Enter never sends "#pla". Typing on drops it.
 */
function useHeldEnter(place: MentionPlace, insert: (at: MentionQuery, first: MentionPerson | MentionChannel) => void) {
  const held = useRef<(() => void) | undefined>(undefined)
  const drop = () => {
    held.current?.()
    held.current = undefined
  }
  const hold = (at: MentionQuery) => {
    drop()
    held.current = onFirstMentionAnswer(at.trigger, at.text, place, (answer) => {
      held.current = undefined
      const first = answer[0]
      if (first !== undefined) insert(at, first)
    })
  }
  return { hold, drop }
}

/** The picked names as the field draws them: a person in their hue, a group as a message draws it (`hueFor` of its id), a channel as its chip. */
const marksOf = (tokens: ReadonlyArray<MentionToken>) =>
  tokens.map((token) => {
    const { kind, id } = token.pick
    if (kind === 'channel') return { start: token.start, end: token.end, look: 'channel' as const }
    return { start: token.start, end: token.end, look: 'person' as const, hue: hueFor(kind === 'person' ? defaultPersonColor(id) : '', id) }
  })
