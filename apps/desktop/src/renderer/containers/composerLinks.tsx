import { Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { clipboardHtml, linkAt, moveLinks, pastedLink, setLink, shownLinks, type LinkRange, type MentionPick } from '@juno/contract'
import { openExternal } from '@juno/state'
import type { ComposerPaste, ComposerPopover } from '@juno/views'
import { chunk, usePreloaded } from './chunks'
import { editField } from './suggestionKeys'
import { commandKey } from '@juno/views'

// The link editor shows only after ⌘K, so it loads when idle once a composer has mounted.
const linkEditor = chunk(() => import('./LinkEditorPanel'))
const LinkEditor = linkEditor.component((module) => module.LinkEditor)

/** The composers that can take ⌘K for a link: each answers whether it took it. */
const editors = new Set<() => boolean>()

/** ⌘K: the focused composer opens its link editor when words are selected in it. False when none did, and ⌘K opens the palette. */
export function editLinkInComposer(): boolean {
  for (const edit of editors) if (edit()) return true
  return false
}

export interface ComposerLinksOptions {
  readonly field: RefObject<HTMLTextAreaElement | null>
  /** The text and links a stored draft starts with (`decodeDraft`). */
  readonly initialText: string
  readonly initial: ReadonlyArray<LinkRange>
  /** The text changed through the field or by the owner: after `moved`, so the draft is saved with the links. */
  readonly onChange: (value: string) => void
}

/**
 * Links in a composer (spec section 8). URLs typed into the field show as
 * links as they stand. A URL pasted over selected words puts a link on
 * them, as Slack, Notion and Notes do: the paste goes in as typing would,
 * then the words go back over it, so ⌘Z first gives the plain paste. ⌘K
 * with words selected opens the link editor; ⌘-click on a link opens it in
 * the browser. The owner calls `moved` with each new text before using it,
 * and reads `current` when it saves or sends.
 */
export function useComposerLinks({ field, initialText, initial, onChange }: ComposerLinksOptions) {
  const links = useRef<ReadonlyArray<LinkRange>>(initial)
  const [drawn, setDrawn] = useState(initial)
  const text = useRef(initialText)

  const keep = (next: ReadonlyArray<LinkRange>) => {
    links.current = next
    setDrawn(next)
  }

  /** The text is now `next`: the links move with the edit. */
  const moved = (next: string) => {
    const element = field.current
    const caret = element !== null && element.value === next ? element.selectionEnd : undefined
    if (links.current.length > 0) keep(moveLinks(text.current, next, links.current, caret))
    text.current = next
  }

  /** Another tab's draft, or a sent one: the text and links start over. */
  const reset = (next: string, nextLinks: ReadonlyArray<LinkRange>) => {
    if (text.current === next && links.current === nextLinks) return
    text.current = next
    keep(nextLinks)
  }

  const onPasteText = (pasted: ComposerPaste, element: HTMLTextAreaElement): boolean => {
    const { selectionStart: start, selectionEnd: end, value } = element
    if (pasted.html !== '') {
      const rich = clipboardHtml(pasted.html)
      if (rich.text === '') return false
      editField(element, start, end, rich.text)
      let next = links.current
      for (const link of rich.links) next = setLink(next, start + link.start, start + link.end, link.url)
      keep(next)
      element.setSelectionRange(start + rich.text.length, start + rich.text.length)
      // The input event saved the text; save once more with its new link ranges.
      onChange(text.current)
      return true
    }
    const url = pastedLink(pasted.plain)
    const words = value.slice(start, end)
    if (url === undefined || start === end || words.includes('\n') || words.trim() === '') return false
    // Two edits, so Undo first takes the words back to the plain paste.
    const plain = pasted.plain.trim()
    editField(element, start, end, plain)
    editField(element, start, start + plain.length, words)
    keep(setLink(links.current, start, start + words.length, url))
    element.setSelectionRange(start + words.length, start + words.length)
    onChange(text.current)
    return true
  }

  const shown = (value: string, picks: ReadonlyArray<MentionPick>) => shownLinks(value, drawn.filter((link) => link.end <= value.length), picks)

  const onFieldClick = (event: MouseEvent<HTMLTextAreaElement>) => {
    if (!commandKey(event)) return
    const element = event.currentTarget
    const link = linkAt(shownLinks(element.value, links.current), element.selectionStart)
    if (link === undefined) return
    event.preventDefault()
    openExternal(link.url)
  }

  const popover = useLinkEditor(field, links, drawn, (range, url) => {
    keep(setLink(links.current, range.start, range.end, url))
    // The text is the same, the draft is not: it is saved with the new link.
    onChange(text.current)
  })

  return { current: () => links.current, moved, reset, shown, onPasteText, onFieldClick, popover }
}

type Range = { readonly start: number; readonly end: number }

/** ⌘K's link editor for the words selected in `field`, while it is open; `onApply` sets or removes their link. */
function useLinkEditor(
  field: RefObject<HTMLTextAreaElement | null>,
  links: RefObject<ReadonlyArray<LinkRange>>,
  drawn: ReadonlyArray<LinkRange>,
  onApply: (range: Range, url: string | undefined) => void,
): ComposerPopover | undefined {
  const [editing, setEditing] = useState<{ readonly start: number; readonly end: number; readonly url: string } | undefined>(undefined)

  // ⌘K reaches this composer while its field has focus and words selected.
  const takeCommandK = useRef<() => boolean>(() => false)
  const commandK = () => {
    const element = field.current
    if (element === null || document.activeElement !== element || element.selectionStart === element.selectionEnd) return false
    const { selectionStart: start, selectionEnd: end } = element
    const current = links.current.find((link) => link.start <= start && link.end >= end) ?? shownLinks(element.value, links.current).find((link) => link.start === start && link.end === end)
    setEditing(current === undefined ? { start, end, url: '' } : current)
    return true
  }
  useLayoutEffect(() => {
    takeCommandK.current = commandK
  })
  useEffect(() => {
    const take = () => takeCommandK.current()
    editors.add(take)
    return () => void editors.delete(take)
  }, [])

  const close = (caret: number | undefined) => {
    setEditing(undefined)
    const element = field.current
    if (element === null) return
    element.focus()
    if (caret !== undefined) element.setSelectionRange(caret, caret)
  }
  const apply = (range: Range, url: string | undefined) => {
    onApply(range, url)
    close(range.end)
  }

  const ready = usePreloaded(linkEditor, editing !== undefined)
  return editing === undefined || !ready
    ? undefined
    : {
        anchorAt: editing.start,
        content: (
          <Suspense fallback={null}>
            <LinkEditor
              key={`${editing.start}-${editing.end}`}
              url={editing.url}
              onSave={(typed) => {
                const url = pastedLink(typed)
                if (url === undefined) return false
                apply(editing, url)
                return true
              }}
              {...(drawn.some((link) => link.start === editing.start && link.end === editing.end) ? { onRemove: () => apply(editing, undefined) } : {})}
              onCancel={() => close(undefined)}
            />
          </Suspense>
        ),
      }
}
