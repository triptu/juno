import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import {
  defaultPersonColor,
  insertMention,
  mentionQueryAt,
  mentionTokens,
  rankSuggestions,
  removeTokenBefore,
  type MentionChannel,
  type MentionPerson,
  type MentionPick,
  type MentionQuery,
  type MentionToken,
} from '@juno/contract'
import { mentionChannelsAtom, mentionPeopleAtom, onFirstMentionAnswer, type MentionPlace } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { hueFor, MentionSuggestions, mentionRowId, type ComposerMention } from '@juno/views'

import { editField, listKey } from './suggestionKeys'
import { useEmojiSuggestions } from './emojiSuggestions'

type Rows = { readonly kind: 'person'; readonly rows: ReadonlyArray<MentionPerson> } | { readonly kind: 'channel'; readonly rows: ReadonlyArray<MentionChannel> }

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
}

/**
 * @ and # suggestions for a composer (spec section 8, inventory 7.1). The
 * owner keeps the text and the picks; this follows the caret, asks the
 * engine for matches (`mentions.people`, `mentions.channels`), and answers
 * the `Composer` props that draw the picked names as chips and the list
 * above the field.
 *
 * Each keystroke narrows the last answer at once (`rankSuggestions` on the
 * rows already here), and the engine's answer for the new query replaces
 * it when it lands, so the list never empties or waits while typing.
 * Picks and Backspace edit the field through `insertText` and `delete`, so
 * ⌘Z undoes them like typing.
 */
export function useMentions({ text, picks, onPicks, onChange, field, place }: MentionsOptions) {
  const emoji = useEmojiSuggestions({ text, onChange, field })
  const listId = useId()
  const [caret, setCaret] = useState(text.length)
  // Esc closed the list for the query starting here; typing a new "@" opens it again.
  const [dismissed, setDismissed] = useState<number | undefined>(undefined)
  const [chosen, setChosen] = useState<string | undefined>(undefined)

  const tokens = mentionTokens(text, picks)
  const typed = mentionQueryAt(text, Math.min(caret, text.length), tokens)
  const query = typed !== undefined && typed.start !== dismissed ? typed : undefined
  const { rows, answered } = useMentionRows(query, place)
  const ids = rows === undefined ? [] : rows.rows.map((row) => mentionRowId(listId, row.id))
  const activeId = chosen !== undefined && ids.includes(chosen) ? chosen : ids[0]
  const open = query !== undefined && rows !== undefined && rows.rows.length > 0

  /** Puts `row` in place of the query `at`, and keeps it with the picks. */
  const insertPick = (at: MentionQuery, row: MentionPerson | MentionChannel) => {
    const picked: MentionPick = { kind: at.trigger === '@' ? 'person' : 'channel', id: row.id, name: row.name }
    if (!picks.some((p) => p.kind === picked.kind && p.id === picked.id && p.name === picked.name)) onPicks([...picks, picked])
    const after = insertMention(text, at, picked)
    // Only what changes is typed: the name, and the space when there is none yet.
    editField(field.current, at.start, at.end, after.text.slice(at.start, after.caret))
  }
  const pick = (rowId: string) => {
    const row = rows?.rows[ids.indexOf(rowId)]
    if (query === undefined || row === undefined) return
    insertPick(query, row)
    setChosen(undefined)
  }
  const held = useHeldEnter(place, (at, first) => {
    // Typing went on meanwhile: that text decides, not this answer.
    if (field.current?.value === text) insertPick(at, first)
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
            list: open && rows !== undefined ? <MentionSuggestions {...rows} id={listId} activeId={activeId} onActivate={setChosen} onPick={pick} /> : null,
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
function useMentionRows(query: MentionQuery | undefined, place: MentionPlace): { readonly rows: Rows | undefined; readonly answered: boolean } {
  const people = useAtomValue(mentionPeopleAtom(query?.trigger === '@' ? query.text : undefined, place))
  const channels = useAtomValue(mentionChannelsAtom(query?.trigger === '#' ? query.text : undefined))
  // Kept as state: a new answer replaces it during render.
  const [last, setLast] = useState<Rows | undefined>(undefined)
  if (query === undefined) return { rows: undefined, answered: false }
  const fresh: Rows | undefined =
    query.trigger === '@'
      ? people._tag === 'Success'
        ? { kind: 'person', rows: people.value }
        : undefined
      : channels._tag === 'Success'
        ? { kind: 'channel', rows: channels.value }
        : undefined
  if (fresh !== undefined) {
    if (fresh.rows !== last?.rows) setLast(fresh)
    return { rows: fresh, answered: true }
  }
  if (last?.kind === 'person' && query.trigger === '@') return { rows: { kind: 'person', rows: rankSuggestions(last.rows, query.text) }, answered: false }
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

/** The picked names as the field draws them: a person in their hue, a channel as its chip. */
const marksOf = (tokens: ReadonlyArray<MentionToken>) =>
  tokens.map((token) => ({
    start: token.start,
    end: token.end,
    look: token.pick.kind,
    ...(token.pick.kind === 'person' ? { hue: hueFor(defaultPersonColor(token.pick.id), token.pick.id) } : {}),
  }))
