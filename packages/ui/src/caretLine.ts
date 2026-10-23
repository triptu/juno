import type { KeyboardEvent } from 'react'

/** The field's styles that decide where its text wraps. */
const WRAP_STYLES = [
  'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'fontFeatureSettings',
  'fontVariationSettings', 'fontKerning', 'letterSpacing', 'wordSpacing', 'lineHeight', 'textIndent',
  'textTransform', 'tabSize', 'direction', 'whiteSpace', 'overflowWrap', 'wordBreak', 'hyphens',
] as const

/**
 * Whether the caret is on the field's first visual line: no line break before it, and the text before it does not
 * wrap. A hidden copy of the field, as wide as its text area, lays out the first line up to the caret and the rest
 * of that line after it, so a word the caret sits in wraps as it does in the field.
 */
export function caretOnFirstLine(field: HTMLTextAreaElement): boolean {
  const at = field.selectionStart
  const before = field.value.slice(0, at)
  if (at === 0) return true
  if (before.includes('\n')) return false
  const style = getComputedStyle(field)
  const copy = document.createElement('div')
  for (const name of WRAP_STYLES) copy.style[name] = style[name]
  Object.assign(copy.style, { position: 'absolute', top: '0', left: '-10000px', visibility: 'hidden', border: '0', width: `${field.clientWidth}px`, boxSizing: 'border-box', overflow: 'hidden' })
  const end = field.value.indexOf('\n', at)
  const head = document.createElement('span')
  head.textContent = before
  const mark = document.createElement('span')
  mark.textContent = field.value.slice(at, end === -1 ? undefined : end) || '​'
  copy.append(head, mark)
  document.body.append(copy)
  const first = head.getClientRects()[0]
  const caret = mark.getClientRects()[0]
  copy.remove()
  return first === undefined || caret === undefined || caret.top < first.top + first.height / 2
}

/**
 * A plain ↑ that leaves the field for what is above it (SPEC section 7, Keyboard): no Shift, ⌘, ⌥ or ⌃, no IME
 * composition, no selection, and the caret on the first visual line. Whatever else owns ↑ (the suggestions) sees
 * the key first.
 */
export function arrowUpLeavesField(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.key !== 'ArrowUp' || event.shiftKey || event.metaKey || event.altKey || event.ctrlKey) return false
  if (event.nativeEvent.isComposing) return false
  const field = event.currentTarget
  return field.selectionStart === field.selectionEnd && caretOnFirstLine(field)
}
