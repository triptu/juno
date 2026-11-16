import type { KeyboardEvent } from 'react'
import type { MarkupLayout } from '@juno/contract'
import { chunk, usePreloaded } from './chunks'
import { commandKey, otherCommandKey } from '@juno/views'

type Rules = typeof import('./markupRules')
type Press = import('./markupRules').Press

let rules: Rules | undefined
const markupRules = chunk(() => import('./markupRules').then((module) => (rules = module)))
const pending = new WeakMap<HTMLTextAreaElement, Press[]>()
const PLAIN: MarkupLayout = { spans: [], markers: [], codeBlocks: [], quotes: [] }

/** The preview loads at mount. Sending is independent of this renderer chunk. */
export function useComposerMarkup(on: boolean) {
  'use no memo'
  const ready = usePreloaded(markupRules, on)
  return {
    format: (text: string, opaque: ReadonlyArray<{ readonly start: number; readonly end: number }> = []): { readonly format?: MarkupLayout } =>
      !on ? {} : { format: ready && rules !== undefined ? rules.markupLayout(text, opaque) : PLAIN },
    onKey: (event: KeyboardEvent<HTMLTextAreaElement>, atomic: ReadonlyArray<{ readonly start: number; readonly end: number }> = []): boolean => {
      if (!on || (!commandKey(event) || otherCommandKey(event)) || event.altKey || event.nativeEvent.isComposing) return false
      const { key, code, metaKey, shiftKey, ctrlKey, altKey, currentTarget: field } = event
      if (!(shiftKey ? /^[xc]$/i.test(key) || code === 'Digit9' : /^[bi]$/i.test(key))) return false
      const press = { key, code, metaKey, shiftKey, ctrlKey, altKey, field, value: field.value, start: field.selectionStart, end: field.selectionEnd, atomic }
      event.preventDefault()
      if (rules !== undefined) { rules.formatKey(press); return true }
      const queued = pending.get(field)
      if (queued !== undefined) { queued.push(press); return true }
      const presses = [press]
      pending.set(field, presses)
      let cancelled = false
      const cancel = () => { cancelled = true }
      const clean = () => {
        field.removeEventListener('blur', cancel)
        field.removeEventListener('compositionstart', cancel)
        pending.delete(field)
      }
      field.addEventListener('blur', cancel)
      field.addEventListener('compositionstart', cancel)
      void markupRules.load().then((loaded) => {
        clean()
        if (!cancelled) loaded.formatKeys(presses)
      }, clean)
      return true
    },
  }
}
