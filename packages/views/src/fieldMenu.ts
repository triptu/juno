import type { MouseEvent } from 'react'

/**
 * Whether a right-click is in a text field. A field keeps the text menu (Cut,
 * Copy, Paste and spelling, from main), so a row's menu leaves it alone. A
 * handler that does open its own menu calls preventDefault, which keeps the
 * text menu from opening as well.
 */
export function inField(event: MouseEvent): boolean {
  const target = event.target
  return target instanceof Element && target.closest('input, textarea, [contenteditable="true"]') !== null
}
