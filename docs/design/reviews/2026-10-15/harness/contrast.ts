// Measures every text node's contrast against what is painted behind it. Copied from docs/reviews/m3/harness.
import type { Page } from '@playwright/test'

export const contrastSweep = (win: Page, root: string) =>
  win.evaluate((rootSelector) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255]
    }
    const over = (top: [number, number, number, number], bottom: [number, number, number, number], alpha = top[3]): [number, number, number, number] => [
      top[0] * alpha + bottom[0] * (1 - alpha),
      top[1] * alpha + bottom[1] * (1 - alpha),
      top[2] * alpha + bottom[2] * (1 - alpha),
      1,
    ]
    const lum = ([r, g, b]: [number, number, number, number]) => {
      const f = (c: number) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (a: [number, number, number, number], b: [number, number, number, number]) => {
      const l1 = lum(a)
      const l2 = lum(b)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }
    const bodyBg = rgba(getComputedStyle(document.body).backgroundColor)
    const results: Array<{ text: string; fg: string; bg: string; ratio: number; opacity: number; size: string; weight: string; path: string }> = []
    const rootEl = document.querySelector(rootSelector)
    if (!rootEl) return results
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT)
    const seen = new Set<string>()
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? '').trim()
      if (!text) continue
      const el = node.parentElement
      if (!el) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      // Walk up: find the nearest painted background and the product of opacities above the text.
      let bg: [number, number, number, number] | undefined
      let opacity = 1
      let bgInsideOpacity = false
      let sawOpacity = false
      let cur: HTMLElement | null = el
      const path: string[] = []
      while (cur) {
        const s = getComputedStyle(cur)
        const o = parseFloat(s.opacity)
        if (o < 1) {
          opacity *= o
          sawOpacity = true
          if (bg === undefined) bgInsideOpacity = true
        }
        if (bg === undefined) {
          const c = rgba(s.backgroundColor)
          if (c[3] > 0) bg = c
        }
        if (path.length < 6) path.push(cur.tagName.toLowerCase() + (cur.getAttribute('role') ? `[${cur.getAttribute('role')}]` : ''))
        cur = cur.parentElement
      }
      void bgInsideOpacity
      void sawOpacity
      const backdrop = bodyBg
      const base = bg ?? backdrop
      const fg = rgba(cs.color)
      // The text and its own background both fade toward the backdrop by the ancestor opacity.
      const fgEff = over(over(fg, base), backdrop, opacity)
      const bgEff = over(base, backdrop, opacity)
      const r = ratio(fgEff, bgEff)
      const key = `${text}|${cs.color}|${r.toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ text: text.slice(0, 40), fg: cs.color, bg: base.map((v) => Math.round(v)).join(','), ratio: Math.round(r * 100) / 100, opacity, size: cs.fontSize, weight: cs.fontWeight, path: path.join('<') })
    }
    return results
  }, root)
