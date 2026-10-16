(() => {
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
  // Any CSS colour (rgb, oklch, color-mix) to [r, g, b, a] through a canvas.
  const parse = (c) => { if (!c || c === 'transparent') return [0, 0, 0, 0]; ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const blend = (top, bottom) => { const a = top[3] ?? 1; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)) }
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] === 1) break } } let base = parse(getComputedStyle(document.body).backgroundColor); for (const c of stack.reverse()) base = blend(c, base); return base }
  const out = []
  for (const el of document.querySelectorAll('[data-fixture-frame] *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')
    if (!own) continue
    const r = el.getBoundingClientRect(); if (r.width === 0) continue
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || +s.opacity === 0) continue
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity
    const bg = bgOf(el); const fc = parse(s.color); const fg = blend([...fc.slice(0, 3), fc[3] * op], bg)
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); const ratio = (a + 0.05) / (b + 0.05)
    const covered = el.parentElement?.querySelector('img') != null
    const disabled = el.closest('[disabled],[aria-disabled="true"]') !== null
    if (ratio < 4.5 && !disabled && !covered) out.push({ t: el.textContent.trim().slice(0, 30), ratio: Math.round(ratio * 100) / 100, size: s.fontSize })
  }
  return out
})()
