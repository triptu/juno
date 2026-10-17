/**
 * Keys typed while focus is on its way to a field: after ⌘N, before Home's
 * search has focus, or after an Enter that waits for its list's rows.
 * `holdKeys` catches them before anything else sees them; `releaseKeys`
 * types them, in order, into whatever has focus then. A key that starts
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

/** Keys that act on a field or a list; any other key, or one with ⌘ or ⌃, goes through as usual. */
const ACTION_KEYS = new Set(['Enter', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown'])

const HOLD_MS = 1_000

let held: HeldKey[] | undefined
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

/** Starts holding keys, or keeps the hold that is on. */
export function holdKeys(): void {
  clearTimeout(timer)
  timer = setTimeout(releaseKeys, HOLD_MS)
  if (held !== undefined) return
  held = []
  window.addEventListener('keydown', onKeyDown, true)
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

const heldNow = (): HeldKey[] | undefined => held

/** One held key, as the focused element would have taken it. */
function typeKey(key: HeldKey): void {
  const target = document.activeElement
  if (!(target instanceof HTMLElement) || target === document.body) return
  const editable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
  const event = new KeyboardEvent('keydown', { key: key.key, code: key.code, shiftKey: key.shiftKey, altKey: key.altKey, bubbles: true, cancelable: true })
  // The element's own key handling first, as for a real key; text goes in only if nothing took the key.
  if (!target.dispatchEvent(event) || !editable) return
  if (isText(key.key)) document.execCommand('insertText', false, key.key)
  else if (key.key === 'Backspace') document.execCommand('delete')
}
