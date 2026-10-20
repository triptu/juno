/**
 * Keys typed while focus is on its way to a field: after ⌘N, before Home's
 * search has focus, or after an Enter that waits for its list's rows.
 * `holdKeys` catches them before anything else sees them; `releaseKeys`
 * types them, in order, into whatever has focus then. A paste (⌘V) in that
 * time is held the same way, in its place among the keys. A key that starts
 * another hold while it is typed (an Enter that has to wait again) leaves
 * the keys after it held. A hold ends by itself after `HOLD_MS`, so keys are
 * never kept for good.
 */

interface HeldKey {
  readonly key: string
  readonly code: string
  readonly shiftKey: boolean
  readonly altKey: boolean
}

/** A paste, with a copy of what it carried: the event's own data is gone once it is handled. */
interface HeldPaste {
  readonly paste: DataTransfer
}

type Held = HeldKey | HeldPaste

/** Keys that act on a field or a list; any other key, or one with ⌘ or ⌃, goes through as usual. */
const ACTION_KEYS = new Set(['Enter', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown'])

const HOLD_MS = 1_000

let held: Held[] | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let releasing = false

const isText = (key: string) => [...key].length === 1

function onKeyDown(event: KeyboardEvent): void {
  if (held === undefined || event.metaKey || event.ctrlKey || event.isComposing) return
  if (!isText(event.key) && !ACTION_KEYS.has(event.key)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  held.push({ key: event.key, code: event.code, shiftKey: event.shiftKey, altKey: event.altKey })
}

function onPaste(event: ClipboardEvent): void {
  if (held === undefined || event.clipboardData === null) return
  event.preventDefault()
  event.stopImmediatePropagation()
  const copy = new DataTransfer()
  for (const type of event.clipboardData.types) if (type !== 'Files') copy.setData(type, event.clipboardData.getData(type))
  for (const file of event.clipboardData.files) copy.items.add(file)
  held.push({ paste: copy })
}

/** Starts holding keys, including a key whose handler started the hold after capture. */
export function holdKeys(initial?: KeyboardEvent): void {
  clearTimeout(timer)
  timer = setTimeout(releaseKeys, HOLD_MS)
  if (held === undefined) {
    held = []
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('paste', onPaste, true)
  }
  if (initial !== undefined) onKeyDown(initial)
}

/**
 * Ends the hold and types the held keys into the focused element, in a
 * microtask so a caller inside a React effect has finished first. Keys
 * typed until then join the end.
 */
export function releaseKeys(): void {
  if (held === undefined || releasing) return
  releasing = true
  clearTimeout(timer)
  queueMicrotask(() => {
    releasing = false
    const keys = held ?? []
    held = undefined
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('paste', onPaste, true)
    for (let at = 0; at < keys.length; at++) {
      // A key typed may have started another hold; the keys after it wait in that one.
      const again = heldNow()
      if (again !== undefined) {
        again.push(...keys.slice(at))
        return
      }
      typeKey(keys[at]!)
    }
  })
}

const heldNow = (): Held[] | undefined => held

/** One held key or paste, as the focused element would have taken it. */
function typeKey(key: Held): void {
  const target = document.activeElement
  if (!(target instanceof HTMLElement) || target === document.body) return
  const editable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
  if ('paste' in key) {
    // The element's own paste handling first (files, a link over selected words); plain text goes in otherwise.
    const pasted = new ClipboardEvent('paste', { clipboardData: key.paste, bubbles: true, cancelable: true })
    if (target.dispatchEvent(pasted) && editable) document.execCommand('insertText', false, key.paste.getData('text/plain'))
    return
  }
  const event = new KeyboardEvent('keydown', { key: key.key, code: key.code, shiftKey: key.shiftKey, altKey: key.altKey, bubbles: true, cancelable: true })
  // The element's own key handling first, as for a real key; text goes in only if nothing took the key.
  if (!target.dispatchEvent(event) || !editable) return
  if (isText(key.key)) document.execCommand('insertText', false, key.key)
  else if (key.key === 'Backspace') document.execCommand('delete')
}
