// The footer's scene: Home's seated j at its table with six of the topic drawings set down beside it, on the field.
// The pointer is a lamp over the paper. The field's colours gather under it and a light pools there, the j leans and
// looks toward it, and the drawings near it lift and part, then settle back into their row when it rests or leaves.
// It rides the footer field's one loop, so it runs only while the footer is on screen, the tab is visible and motion
// is allowed, and it writes transforms only. A touch drag moves the lamp; a tap lights it for a moment.
(() => {
  const footer = document.querySelector('.footer')
  const field = window.junoFields?.get('footer')
  const jBox = footer?.querySelector('.j')
  if (!footer || !field || !jBox) return

  const spring = (k, zeta) => ({ k, c: 2 * Math.sqrt(k) * zeta })
  const PIECE = spring(70, 0.82)
  const J = spring(45, 0.9)
  const REACH = 170 // px: drawings this close to the pointer move out of its way
  const PART = 54 // px: how far one moves at most
  const LIFT = 0.55 // the move has an upward bias, so they float up and out
  const PARALLAX = 22 // px across the footer's width, at depth 1
  const BOB = 1.4 // px of idle rise and fall
  const LEAN = 6 // degrees the j leans toward the pointer at most
  const LOOK = 3 // px the j's head moves toward the pointer at most

  /** x, y: the pointer; lx, ly: the lamp, which trails it; until: when the pointer stops counting as present;
   *  lit: presence, 0 to 1; stir: 1 while the pointer moves, fading once it rests. */
  const pointer = { x: 0, y: 0, lx: 0, ly: 0, until: 0, lit: 0, stir: 0 }
  const pieces = [...footer.querySelectorAll('.piece')].map((el, i) => ({
    el, depth: Number(el.dataset.depth) || 1, phase: i * 1.9, sx: 0, sy: 0, x: 0, y: 0, vx: 0, vy: 0, tilt: 0,
  }))
  const bodies = [...footer.querySelectorAll('.j-body')]
  const heads = [...footer.querySelectorAll('.j-head')]
  const j = { x: 0, y: 0, angle: 0, va: 0, lookX: 0, lookY: 0, vlx: 0, vly: 0 }
  let width = 1
  let height = 1

  /** Where everything rests, in footer pixels. Runs on setup and resize, never in the loop. */
  function measure() {
    const box = footer.getBoundingClientRect()
    width = box.width || 1
    height = box.height || 1
    for (const p of pieces) {
      const r = p.el.getBoundingClientRect()
      p.sx = r.left - box.left + r.width / 2 - p.x
      p.sy = r.top - box.top + r.height / 2 - p.y
    }
    const r = jBox.getBoundingClientRect()
    j.x = r.left - box.left + r.width / 2
    j.y = r.top - box.top + r.height * 0.3
  }
  measure()
  new ResizeObserver(measure).observe(footer)

  const locate = (e) => {
    const box = footer.getBoundingClientRect()
    pointer.x = e.clientX - box.left
    pointer.y = e.clientY - box.top
  }
  const snap = () => { if (pointer.lit < 0.02) { pointer.lx = pointer.x; pointer.ly = pointer.y } }
  const touch = (e) => e.pointerType === 'touch'
  footer.addEventListener('pointerenter', (e) => { if (touch(e)) return; locate(e); snap(); pointer.until = Infinity })
  footer.addEventListener('pointerdown', (e) => { locate(e); snap(); pointer.stir = 1; pointer.until = Infinity })
  footer.addEventListener('pointermove', (e) => {
    const ox = pointer.x
    const oy = pointer.y
    locate(e)
    if (Math.hypot(pointer.x - ox, pointer.y - oy) > 1) pointer.stir = 1
    if (!touch(e)) pointer.until = Infinity
  })
  const release = (e) => { if (touch(e)) pointer.until = performance.now() + 1400 }
  footer.addEventListener('pointerup', release)
  footer.addEventListener('pointercancel', release)
  footer.addEventListener('pointerleave', (e) => { if (!touch(e)) pointer.until = performance.now() })

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const ease = (dt, tau) => 1 - Math.exp(-dt / tau)
  let lastNow = 0
  field.onFrame = (now) => {
    const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 1 / 60)
    lastNow = now
    const t = now / 1000
    const present = now < pointer.until
    pointer.lit += ((present ? 1 : 0) - pointer.lit) * ease(dt, present ? 0.22 : 0.8)
    pointer.stir *= Math.exp(-dt / 0.5)
    const k = ease(dt, 0.07)
    pointer.lx += (pointer.x - pointer.lx) * k
    pointer.ly += (pointer.y - pointer.ly) * k
    field.setLamp(pointer.lx, pointer.ly, pointer.lit)

    const { lit, stir, x: px, y: py } = pointer
    for (const p of pieces) {
      let tx = ((px - width / 2) / width) * PARALLAX * p.depth * lit
      let ty = ((py - p.sy) / height) * 10 * p.depth * lit
      const dx = p.sx - px
      const dy = p.sy - py
      const d = Math.hypot(dx, dy)
      if (d < REACH) {
        const f = (1 - d / REACH) ** 2 * stir * lit * PART
        const inv = 1 / Math.max(d, 1)
        tx += dx * inv * f
        ty += (dy * inv - LIFT) * f
      }
      ty += Math.sin(t * (Math.PI / 3.5) + p.phase) * BOB
      p.vx += (PIECE.k * (tx - p.x) - PIECE.c * p.vx) * dt
      p.vy += (PIECE.k * (ty - p.y) - PIECE.c * p.vy) * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.tilt += (clamp(p.vx * 0.05, -7, 7) - p.tilt) * ease(dt, 0.12)
      p.el.style.transform = `translate3d(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px, 0) rotate(${p.tilt.toFixed(2)}deg)`
    }

    const lean = clamp(((px - j.x) / width) * 16, -LEAN, LEAN) * lit
    const ddx = px - j.x
    const ddy = py - j.y
    const dd = Math.hypot(ddx, ddy) || 1
    const lookX = (ddx / dd) * LOOK * lit
    const lookY = (ddy / dd) * LOOK * lit
    j.va += (J.k * (lean - j.angle) - J.c * j.va) * dt
    j.angle += j.va * dt
    j.vlx += (J.k * (lookX - j.lookX) - J.c * j.vlx) * dt
    j.lookX += j.vlx * dt
    j.vly += (J.k * (lookY - j.lookY) - J.c * j.vly) * dt
    j.lookY += j.vly * dt
    const turn = `rotate(${j.angle.toFixed(2)}deg)`
    for (const el of bodies) el.style.transform = turn
    const look = `${turn} translate(${j.lookX.toFixed(2)}px, ${j.lookY.toFixed(2)}px)`
    for (const el of heads) el.style.transform = look
  }
  field.tick()
})()
