/**
 * Finds text that paints over other text inside one fixture frame: the
 * check behind narrow-geometry.spec.ts. Runs in the page, so it must stay
 * self-contained (no imports, no outer variables).
 *
 * Each text node's line boxes are clipped by every ancestor that clips
 * (the frame included), so text an ellipsis or a scroller hides does not
 * count. Two boxes from different nodes that intersect by more than a
 * pixel each way overlap, unless an opaque layer lies between them at that
 * point (a header band over a scrolled list, a dialog over its page).
 * With `buttons`, a button whose label is cut by an ellipsis is reported
 * too: for states whose buttons are all verbs (a card's footer), not those
 * with tabs or pickers whose names are meant to shorten.
 */
export function findOverlaps({ route, buttons }: { readonly route: string; readonly buttons: boolean }): ReadonlyArray<string> {
  const frame = document.querySelector(`[data-fixture-frame="${CSS.escape(route)}"]`)
  if (frame === null) return [`no frame ${route}`]
  // elementsFromPoint skips elements that ignore the pointer; for this check every layer counts.
  const unblock = document.createElement('style')
  unblock.textContent = `[data-fixture-frame] * { pointer-events: auto !important; }`
  document.head.append(unblock)
  try {
    type Box = { left: number; top: number; right: number; bottom: number }
    const clips = (element: Element): Box => {
      let box: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node)
        const x = style.overflowX !== 'visible'
        const y = style.overflowY !== 'visible'
        if (!x && !y) {
          if (node === frame) break
          continue
        }
        const r = node.getBoundingClientRect()
        box = {
          left: x ? Math.max(box.left, r.left) : box.left,
          right: x ? Math.min(box.right, r.right) : box.right,
          top: y ? Math.max(box.top, r.top) : box.top,
          bottom: y ? Math.min(box.bottom, r.bottom) : box.bottom,
        }
        if (node === frame) break
      }
      return box
    }
    const painted = (element: Element): boolean => {
      const style = getComputedStyle(element)
      return (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') || parseFloat(style.borderLeftWidth) > 0
    }
    const found: string[] = []
    const texts: Array<{ owner: Element; label: string; boxes: Box[] }> = []
    const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const value = node.textContent?.trim() ?? ''
      const owner = node.parentElement
      if (value.length === 0 || owner === null) continue
      if (!owner.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      const clip = clips(owner)
      const range = document.createRange()
      range.selectNodeContents(node)
      const boxes = [...range.getClientRects()]
        .map((r) => ({ left: Math.max(r.left, clip.left), right: Math.min(r.right, clip.right), top: Math.max(r.top, clip.top), bottom: Math.min(r.bottom, clip.bottom) }))
        .filter((b) => b.right - b.left > 1 && b.bottom - b.top > 1)
      if (boxes.length === 0) continue
      texts.push({ owner, label: value.slice(0, 40), boxes })
      // Text that runs out of the nearest box it is drawn on (a pill, a chip, a field): a box too narrow for what it holds.
      let surface: Element | null = owner
      while (surface !== null && surface !== frame && !painted(surface)) surface = surface.parentElement
      if (surface !== null && surface !== frame) {
        const r = surface.getBoundingClientRect()
        if (boxes.some((b) => b.left < r.left - 1 || b.right > r.right + 1)) found.push(`"${value.slice(0, 40)}" runs out of its box`)
      }
    }
    const opaque = (element: Element): boolean => {
      const style = getComputedStyle(element)
      if (style.backdropFilter !== 'none' || style.backgroundImage !== 'none') return true
      const alpha = style.backgroundColor.match(/[\d.]+/g)
      return alpha !== null && (alpha.length < 4 ? true : Number(alpha[3]) >= 0.5) && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    }
    // At (x, y), is there an opaque layer between the upper and the lower text?
    const separated = (a: Element, b: Element, x: number, y: number): boolean => {
      const stack = document.elementsFromPoint(x, y)
      // Text that runs out of its element's box is not hit there: it is the lower one.
      const at = (owner: Element) => {
        const index = stack.findIndex((element) => element === owner || owner.contains(element))
        return index === -1 ? stack.length : index
      }
      const ia = at(a)
      const ib = at(b)
      const [upper, lower] = ia < ib ? [ia, ib] : [ib, ia]
      const lowerOwner = ia < ib ? b : a
      return stack.slice(upper + 1, lower).some((element) => !element.contains(lowerOwner) && opaque(element))
    }
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
        const style = getComputedStyle(element)
        if (style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + 1) found.push(`button "${button.textContent?.trim()}" is cut`)
      }
    }
    return [...new Set(found)]
  } finally {
    unblock.remove()
  }
}
