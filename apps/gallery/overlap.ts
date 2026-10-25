import type { Page } from '@playwright/test'

/**
 * Finds text that paints over other text inside one fixture frame: the
 * check behind narrow-geometry.spec.ts.
 *
 * Each text node's line boxes are clipped by every ancestor that clips
 * (the frame included), so text an ellipsis or a scroller hides does not
 * count. Two boxes from different nodes that intersect by more than a
 * pixel each way overlap, unless an opaque layer lies between them at that
 * point (a header band over a scrolled list, a dialog over its page).
 * Text that runs out of the nearest box it is drawn on (a pill, a chip)
 * is reported too. With `buttons`, so is a button whose label is cut by
 * an ellipsis: for states whose buttons are all verbs (a card's footer),
 * not those with tabs or pickers whose names are meant to shorten.
 */
export async function findOverlaps(page: Page, check: { readonly route: string; readonly buttons: boolean }): Promise<ReadonlyArray<string>> {
  // The functions below run in the page: their source goes in as one expression, so they may use only each other.
  const source = [clipOf, isPainted, isOpaque, textBoxes, separated, overlapsIn].map(String).join('\n')
  return page.evaluate<ReadonlyArray<string>>(`(() => {\n${source}\nreturn overlapsIn(${JSON.stringify(check.route)}, ${check.buttons})\n})()`)
}

type Box = { left: number; top: number; right: number; bottom: number }
type TextBoxes = { owner: Element; label: string; boxes: Box[] }

/** The part of the window every clipping ancestor of `element`, up to `frame`, leaves visible. */
function clipOf(element: Element, frame: Element): Box {
  let box: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node)
    const x = style.overflowX !== 'visible'
    const y = style.overflowY !== 'visible'
    if (x || y) {
      const r = node.getBoundingClientRect()
      box = {
        left: x ? Math.max(box.left, r.left) : box.left,
        right: x ? Math.min(box.right, r.right) : box.right,
        top: y ? Math.max(box.top, r.top) : box.top,
        bottom: y ? Math.min(box.bottom, r.bottom) : box.bottom,
      }
    }
    if (node === frame) break
  }
  return box
}

function isPainted(element: Element): boolean {
  const style = getComputedStyle(element)
  return (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') || parseFloat(style.borderLeftWidth) > 0
}

function isOpaque(element: Element): boolean {
  const style = getComputedStyle(element)
  if (style.backdropFilter !== 'none' || style.backgroundImage !== 'none') return true
  const alpha = style.backgroundColor.match(/[\d.]+/g)
  return alpha !== null && (alpha.length < 4 || Number(alpha[3]) >= 0.5) && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
}

/** Every visible text node's clipped line boxes; `found` gets the ones that run out of their pill or chip. */
function textBoxes(frame: Element, found: string[]): TextBoxes[] {
  const texts: TextBoxes[] = []
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const label = node.textContent?.trim().slice(0, 40) ?? ''
    const owner = node.parentElement
    if (label.length === 0 || owner === null || !owner.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
    const clip = clipOf(owner, frame)
    const range = document.createRange()
    range.selectNodeContents(node)
    const boxes = [...range.getClientRects()]
      .map((r) => ({ left: Math.max(r.left, clip.left), right: Math.min(r.right, clip.right), top: Math.max(r.top, clip.top), bottom: Math.min(r.bottom, clip.bottom) }))
      .filter((b) => b.right - b.left > 1 && b.bottom - b.top > 1)
    if (boxes.length === 0) continue
    texts.push({ owner, label, boxes })
    let surface: Element | null = owner
    while (surface !== null && surface !== frame && !isPainted(surface)) surface = surface.parentElement
    if (surface === null || surface === frame) continue
    const r = surface.getBoundingClientRect()
    if (boxes.some((b) => b.left < r.left - 1 || b.right > r.right + 1)) found.push(`"${label}" runs out of its box`)
  }
  return texts
}

/** At (x, y), is there an opaque layer between the upper and the lower text? */
function separated(a: Element, b: Element, x: number, y: number): boolean {
  const stack = document.elementsFromPoint(x, y)
  // Text that runs out of its element's box is not hit there: it is the lower one.
  const at = (owner: Element) => {
    const index = stack.findIndex((element) => element === owner || owner.contains(element))
    return index === -1 ? stack.length : index
  }
  const ia = at(a)
  const ib = at(b)
  const lowerOwner = ia < ib ? b : a
  return stack.slice(Math.min(ia, ib) + 1, Math.max(ia, ib)).some((element) => !element.contains(lowerOwner) && isOpaque(element))
}

function overlapsIn(route: string, buttons: boolean): string[] {
  const frame = document.querySelector(`[data-fixture-frame="${CSS.escape(route)}"]`)
  if (frame === null) return [`no frame ${route}`]
  // elementsFromPoint skips elements that ignore the pointer; for this check every layer counts.
  const unblock = document.createElement('style')
  unblock.textContent = `[data-fixture-frame] * { pointer-events: auto !important; }`
  document.head.append(unblock)
  try {
    const found: string[] = []
    const texts = textBoxes(frame, found)
    for (const [i, a] of texts.entries()) {
      for (const b of texts.slice(i + 1)) {
        if (a.owner === b.owner) continue
        for (const p of a.boxes) {
          const hit = b.boxes.find((q) => Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1)
          if (hit === undefined) continue
          const x = (Math.max(p.left, hit.left) + Math.min(p.right, hit.right)) / 2
          const y = (Math.max(p.top, hit.top) + Math.min(p.bottom, hit.bottom)) / 2
          if (!separated(a.owner, b.owner, x, y)) found.push(`"${a.label}" overlaps "${b.label}"`)
          break
        }
      }
    }
    for (const button of buttons ? frame.querySelectorAll('button') : []) {
      if (!button.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      for (const element of [button, ...button.querySelectorAll('*')]) {
        if (getComputedStyle(element).textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + 1) found.push(`button "${button.textContent?.trim()}" is cut`)
      }
    }
    return [...new Set(found)]
  } finally {
    unblock.remove()
  }
}
