import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import type { QuickReaction } from '@juno/contract'
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
  const workspace = useMemo(() => answer._tag !== 'Success' ? EMPTY_ROWS : customEmoji(answer.value).map((emoji) => ({ id: emoji.name, name: emoji.name, insert: `:${emoji.name}:`, url: emoji.url })), [answer])
  return useMemo(() => mergeRows(standard, workspace), [standard, workspace])
}

interface WorkspaceEmoji {
  readonly name: string
  readonly url: string | null
  readonly alias_for: string | null
}

/** The workspace's custom emoji with images, aliases resolved to their target's image, in name order. */
export function customEmoji(rows: ReadonlyArray<WorkspaceEmoji>): ReadonlyArray<{ readonly name: string; readonly url: string }> {
  if (rows.length === 0) return []
  const byName = new Map(rows.map((emoji) => [emoji.name, emoji]))
  return rows.flatMap((emoji) => {
    let target: WorkspaceEmoji | undefined = emoji
    const seen = new Set<string>()
    while (target?.url == null && target?.alias_for != null && !seen.has(target.name)) {
      seen.add(target.name)
      target = byName.get(target.alias_for)
    }
    return target?.url == null ? [] : [{ name: emoji.name, url: target.url }]
  }).toSorted((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
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

/**
 * The common prior, ranked after recent use and before name order, so `:thumbs` offers 👍 before 👎 (SPEC 8):
 * the user's quick reactions in their order, then these common emoji.
 */
const COMMON = ['👍', '✅', '👀', '🙏', '🎉', '❤️', '😂', '🔥', '💯', '🙌'].map((glyph) => glyph.replaceAll('\uFE0F', ''))
const plain = (glyph: string) => glyph.replaceAll('\uFE0F', '')

/** A row's place in the common prior, or -1. A standard quick reaction also ranks its aliases, which insert the same glyph. */
function commonRank(row: EmojiSuggestion, quick: ReadonlyArray<QuickReaction>): number {
  const glyph = plain(row.insert)
  const own = quick.findIndex((reaction) => reaction.name === row.name || (reaction.url === undefined && row.url === undefined && plain(reaction.unicode) === glyph))
  if (own >= 0) return own
  const common = COMMON.indexOf(glyph)
  return common < 0 ? -1 : quick.length + common
}

function matching(rows: ReadonlyArray<EmojiSuggestion>, query: string, quick: ReadonlyArray<QuickReaction>) {
  const recent = recentEmoji()
  const matches = rows.filter((row) => row.name.includes(query))
  const frequent = recent.flatMap((name) => matches.find((row) => row.name === name) ?? [])
  const rest = matches.filter((row) => !recent.includes(row.name))
  const rank = new Map(rest.map((row) => [row, commonRank(row, quick)]))
  const common = rest.filter((row) => rank.get(row)! >= 0).toSorted((a, b) => rank.get(a)! - rank.get(b)!)
  const others = rest.filter((row) => rank.get(row)! < 0)
  return [...frequent, ...common, ...others.filter((row) => row.name.startsWith(query)), ...others.filter((row) => !row.name.startsWith(query))].slice(0, 8)
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
  const quick = useAtomValue(quickReactionsAtom)
  const rows = query === undefined ? [] : matching(catalog, query.text, quick)
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
