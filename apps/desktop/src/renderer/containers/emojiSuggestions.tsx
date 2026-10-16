import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import { customEmoji, EMOJI_QUERY_MIN, emojiQueryAt, matchEmoji, mergeEmoji } from '@juno/contract'
import { composerEmojiAtom, quickReactionsAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { MentionSuggestions, mentionRowId, type ComposerMention, type EmojiSuggestion } from '@juno/views'
import { noteRecentEmoji, recentEmoji } from './recentEmoji'
import { editField, listKey } from './suggestionKeys'

interface Options {
  readonly text: string
  readonly onChange: (value: string) => void
  readonly field: RefObject<HTMLTextAreaElement | null>
}

const EMPTY_ROWS: ReadonlyArray<EmojiSuggestion> = []

function useEmojiRows(open: boolean) {
  const custom = useAtomValue(composerEmojiAtom(open))
  const [standard, setStandard] = useState(EMPTY_ROWS)
  const [answer, setAnswer] = useState(custom)
  if (custom._tag === 'Success' && (answer._tag !== 'Success' || custom.value !== answer.value)) setAnswer(custom)
  useEffect(() => {
    if (!open || standard.length > 0) return
    let live = true
    void import('./emojiMatches').then((data) => { if (live) setStandard(data.standardEmoji) })
    return () => { live = false }
  }, [open, standard])
  // The workspace answer alone owns alias resolution and sorting, never a standard-catalog update.
  const workspace = useMemo(() => answer._tag !== 'Success' ? EMPTY_ROWS : customEmoji(answer.value).map((emoji) => ({ id: emoji.name, name: emoji.name, insert: `:${emoji.name}:`, url: emoji.url })), [answer])
  return useMemo(() => mergeEmoji(standard, workspace), [standard, workspace])
}

/** Local colon suggestions share the mention list's anchor, rows, and keyboard handling. */
export function useEmojiSuggestions({ text, onChange, field }: Options) {
  const listId = useId()
  const [caret, setCaret] = useState(text.length)
  const [dismissed, setDismissed] = useState<number | undefined>(undefined)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const typed = emojiQueryAt(text, Math.min(caret, text.length))
  const loading = typed !== undefined && (/^[a-z]/.test(typed.text) || typed.text.length >= EMOJI_QUERY_MIN)
  const catalog = useEmojiRows(loading && typed.start !== dismissed)
  const query = typed === undefined || typed.start === dismissed || typed.text.length < EMOJI_QUERY_MIN ? undefined : typed
  const quick = useAtomValue(quickReactionsAtom)
  const rows = query === undefined ? [] : matchEmoji(catalog, query.text, recentEmoji(), quick)
  const ids = rows.map((row) => mentionRowId(listId, row.id))
  const activeId = chosen !== undefined && ids.includes(chosen) ? chosen : ids[0]
  const pick = (id: string) => {
    const row = rows[ids.indexOf(id)]
    if (query === undefined || row === undefined) return
    noteRecentEmoji(row.name)
    editField(field.current, query.start, query.end, `${row.insert} `)
    setChosen(undefined)
  }
  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (typed === undefined) return false
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false
    if (event.key === ':' && typed !== undefined && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
      const exact = catalog.find((row) => row.name === typed.text)
      if (exact !== undefined) {
        event.preventDefault()
        noteRecentEmoji(exact.name)
        editField(field.current, typed.start, typed.end, exact.insert)
        setDismissed(typed.start)
        return true
      }
    }
    return activeId !== undefined && listKey(event, ids, activeId, { move: setChosen, pick, close: () => setDismissed(query?.start) })
  }
  return {
    onChange: (value: string, at: number) => {
      const next = emojiQueryAt(value, at)
      if (next !== undefined || typed !== undefined) setCaret(at)
      if (dismissed !== undefined && next?.start !== dismissed) setDismissed(undefined)
      onChange(value)
    },
    onCaret: (at: number) => { if (text.includes(':')) setCaret(at) },
    onFieldKey,
    marks: [],
    mention: query === undefined ? undefined : {
      anchorAt: query.start, listId, activeId,
      list: rows.length === 0 ? null : <MentionSuggestions kind="emoji" rows={rows} id={listId} activeId={activeId} onActivate={setChosen} onPick={pick} />,
      onDismiss: () => setDismissed(query.start),
    } satisfies ComposerMention,
  }
}
