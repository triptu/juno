import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import { composerEmojiAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { MentionSuggestions, mentionRowId, type ComposerMention, type EmojiSuggestion } from '@juno/views'
import { noteRecentEmoji, recentEmoji } from './recentEmoji'
import { editField, listKey } from './suggestionKeys'

interface Options {
  readonly text: string
  readonly onChange: (value: string) => void
  readonly field: RefObject<HTMLTextAreaElement | null>
}

const queryAt = (text: string, caret: number) => {
  if (!text.includes(':')) return undefined
  const match = /(?:^|[^\p{L}\p{N}_:])(:([a-zA-Z0-9_+-]{1,}))$/u.exec(text.slice(0, caret))
  return match?.[1] === undefined ? undefined : { start: caret - match[1].length, end: caret, text: match[2]!.toLowerCase() }
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
  const workspace = useMemo(() => {
    if (answer._tag !== 'Success' || answer.value.length === 0) return EMPTY_ROWS
    const byName = new Map(answer.value.map((emoji) => [emoji.name, emoji]))
    return answer.value.flatMap((emoji) => {
      let target: typeof emoji | undefined = emoji
      const seen = new Set<string>()
      while (target?.url == null && target?.alias_for != null && !seen.has(target.name)) {
        seen.add(target.name)
        target = byName.get(target.alias_for)
      }
      return target?.url == null ? [] : [{ id: emoji.name, name: emoji.name, insert: `:${emoji.name}:`, url: target.url }]
    }).toSorted((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  }, [answer])
  return useMemo(() => mergeRows(standard, workspace), [standard, workspace])
}

/** Both inputs are sorted; custom names replace standard names without sorting the catalog again. */
function mergeRows(standard: ReadonlyArray<EmojiSuggestion>, custom: ReadonlyArray<EmojiSuggestion>) {
  if (custom.length === 0) return standard
  const rows: EmojiSuggestion[] = []
  let at = 0
  for (const emoji of standard) {
    while (at < custom.length && custom[at]!.name < emoji.name) rows.push(custom[at++]!)
    if (custom[at]?.name === emoji.name) rows.push(custom[at++]!)
    else rows.push(emoji)
  }
  return [...rows, ...custom.slice(at)]
}

function matching(rows: ReadonlyArray<EmojiSuggestion>, query: string) {
  const recent = recentEmoji()
  const matches = rows.filter((row) => row.name.includes(query))
  const frequent = recent.flatMap((name) => matches.find((row) => row.name === name) ?? [])
  const rest = matches.filter((row) => !recent.includes(row.name))
  return [...frequent, ...rest.filter((row) => row.name.startsWith(query)), ...rest.filter((row) => !row.name.startsWith(query))].slice(0, 8)
}

/** Local colon suggestions share the mention list's anchor, rows, and keyboard handling. */
export function useEmojiSuggestions({ text, onChange, field }: Options) {
  const listId = useId()
  const [caret, setCaret] = useState(text.length)
  const [dismissed, setDismissed] = useState<number | undefined>(undefined)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const typed = queryAt(text, Math.min(caret, text.length))
  const loading = typed !== undefined && (/^[a-z]/.test(typed.text) || typed.text.length >= 2)
  const catalog = useEmojiRows(loading && typed.start !== dismissed)
  const query = typed === undefined || typed.start === dismissed || typed.text.length < 2 ? undefined : typed
  const rows = query === undefined ? [] : matching(catalog, query.text)
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
      const next = queryAt(value, at)
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
