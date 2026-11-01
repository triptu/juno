// The hero's hover: a breeze through the print. Near the pointer the blossoms stir in the direction it moves and settle
// back, and now and then a petal comes loose and drifts down past the frame. It starts after the page has loaded and
// rides the hero field's one loop, so it runs only while the hero is on screen, the tab is visible and motion is
// allowed. It writes transforms and opacity, plus one small canvas over the print. A touch drag works like the
// pointer; on release the effect settles.
(() => {
  const art = document.querySelector('.hero-art')
  const opening = document.querySelector('.opening')
  const print = art?.querySelector('.print')
  const img = print?.querySelector('img')
  const field = window.junoFields?.get('hero')
  if (!img || !field) return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const ease = (dt, tau) => 1 - Math.exp(-dt / tau)

  /** The pointer in the hero art's own pixels (its untransformed box), with its smoothed velocity and presence. */
  const ptr = { x: 0, y: 0, vx: 0, vy: 0, lastX: 0, lastY: 0, until: 0, lit: 0, seen: false }
  /** The print image's place inside the art, in CSS pixels. Measured on resize, never in the loop. */
  const box = { ix: 0, iy: 0, iw: 1, ih: 1 }
  function measure() {
    const a = art.getBoundingClientRect()
    const i = img.getBoundingClientRect()
    box.ix = i.left - a.left
    box.iy = i.top - a.top
    box.iw = img.offsetWidth || 1
    box.ih = img.offsetHeight || 1
  }

  const locate = (e) => {
    const a = art.getBoundingClientRect()
    ptr.x = e.clientX - a.left
    ptr.y = e.clientY - a.top
    if (!ptr.seen) { ptr.lastX = ptr.x; ptr.lastY = ptr.y; ptr.seen = true }
  }
  const touch = (e) => e.pointerType === 'touch'
  opening.addEventListener('pointerenter', (e) => { if (touch(e)) return; locate(e); ptr.until = Infinity })
  opening.addEventListener('pointerdown', (e) => { locate(e); ptr.until = Infinity })
  opening.addEventListener('pointermove', (e) => { locate(e); if (!touch(e)) ptr.until = Infinity })
  const release = (e) => { if (touch(e)) ptr.until = performance.now() + 1200 }
  opening.addEventListener('pointerup', release)
  opening.addEventListener('pointercancel', release)
  opening.addEventListener('pointerleave', (e) => { if (!touch(e)) ptr.until = performance.now() })

  let lastNow = 0
  /** Advances the shared pointer state; returns dt in seconds. */
  function step(now) {
    const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 1 / 60)
    lastNow = now
    const present = now < ptr.until
    ptr.lit += ((present ? 1 : 0) - ptr.lit) * ease(dt, present ? 0.3 : 0.9)
    const k = ease(dt, 0.08)
    ptr.vx += ((ptr.x - ptr.lastX) / dt - ptr.vx) * k
    ptr.vy += ((ptr.y - ptr.lastY) / dt - ptr.vy) * k
    ptr.lastX = ptr.x
    ptr.lastY = ptr.y
    return dt
  }

  // ---- a canvas over the print ----------------------------------------------------------------------------------
  /** Set by the print canvas, so a resize can size it again and ask for a fresh frame. */
  let onResize = null
  const VERT = 'attribute vec2 p; varying vec2 v_uv; void main() { v_uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }'
  function printCanvas(frag, names) {
    const canvas = document.createElement('canvas')
    canvas.className = 'print-gl'
    canvas.setAttribute('aria-hidden', 'true')
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!gl) return null
    const program = gl.createProgram()
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]]) {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(shader)); return null }
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const p = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(p)
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0)
    // The picture, scaled to a power of two so it can carry mipmaps and look as smooth as the <img> under it.
    const scratch = document.createElement('canvas')
    scratch.width = 1024
    scratch.height = 1024
    const c2 = scratch.getContext('2d')
    c2.imageSmoothingQuality = 'high'
    c2.drawImage(img, 0, 0, 1024, 1024)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, scratch)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const u = {}
    for (const name of ['u_res', ...names]) u[name] = gl.getUniformLocation(program, name)
    print.append(canvas)
    const view = {
      gl, u, canvas,
      resize() {
        const scale = Math.min(devicePixelRatio || 1, 2)
        const w = Math.max(1, Math.round(box.iw * scale))
        const h = Math.max(1, Math.round(box.ih * scale))
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
          gl.viewport(0, 0, w, h)
        }
        gl.uniform2f(u.u_res, box.iw, box.ih)
      },
      draw() { gl.drawArrays(gl.TRIANGLES, 0, 3) },
      /** The canvas shows only while the effect is on; at rest the <img> is what you see. */
      show(o) {
        const v = o < 0.004 ? '0' : o.toFixed(3)
        if (canvas.style.opacity !== v) canvas.style.opacity = v
      },
    }
    view.resize()
    onResize = () => { view.resize(); view.stale = true }
    return view
  }

  // ---- breeze ---------------------------------------------------------------------------------------------------
  const BREEZE = `
precision mediump float;
uniform sampler2D u_img;
uniform vec2 u_res;
uniform vec2 u_p;
uniform vec2 u_w;
uniform float u_f;
uniform float u_t;
varying vec2 v_uv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 px = v_uv * u_res;
  vec2 d = (px - u_p) / 160.0;
  float fall = exp(-dot(d, d));
  float n = noise(px / 34.0 + vec2(u_t * 0.5, u_t * 0.2));
  float m = noise(px / 19.0 - vec2(u_t * 0.8, u_t * 0.3));
  vec2 perp = vec2(-u_w.y, u_w.x);
  vec2 off = (u_w * (0.35 + 0.9 * n) + perp * 0.6 * (m - 0.5)) * fall;
  off += vec2(sin(u_t * 6.3 + n * 11.0), cos(u_t * 5.1 + m * 13.0)) * u_f * fall;
  gl_FragColor = vec4(texture2D(u_img, (px - off) / u_res).rgb, 1.0);
}`

  function breeze() {
    const view = printCanvas(BREEZE, ['u_p', 'u_w', 'u_f', 'u_t'])
    if (!view) return null
    const { gl, u } = view
    // A small copy of the picture, read once, to start petals on blossoms rather than on sky.
    const map = document.createElement('canvas')
    map.width = 140
    map.height = 111
    const mc = map.getContext('2d', { willReadFrequently: true })
    mc.drawImage(img, 0, 0, 140, 111)
    const pixels = mc.getImageData(0, 0, 140, 111).data
    const whiteness = (x, y) => {
      const i = (Math.floor((y / box.ih) * 111) * 140 + Math.floor((x / box.iw) * 140)) * 4
      return Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) / 255
    }

    const layer = document.createElement('div')
    layer.className = 'petals'
    layer.setAttribute('aria-hidden', 'true')
    art.append(layer)
    const petals = []

    const w = { x: 0, y: 0, vx: 0, vy: 0, f: 0, cx: 0, cy: 0, gust: 0, lastPetal: 0, still: true }
    const K = 38
    const C = 2 * Math.sqrt(K) * 0.42 // under-damped: one soft sway back, then still

    function loosen(now) {
      // The whitest of a few spots near the pointer, if any is a blossom.
      let best = null
      let bw = 0.72
      for (let i = 0; i < 28; i++) {
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * 70
        const x = ptr.x - box.ix + Math.cos(a) * r
        const y = ptr.y - box.iy + Math.sin(a) * r
        if (x < 4 || y < 4 || x > box.iw - 4 || y > box.ih - 4) continue
        const v = whiteness(x, y)
        if (v > bw) { bw = v; best = [x, y] }
      }
      if (!best) return
      w.lastPetal = now
      const el = document.createElement('span')
      el.className = 'petal'
      layer.append(el)
      petals.push({
        el, born: now, x: best[0] + box.ix, y: best[1] + box.iy, vx: w.vx * 4 + Math.sign(ptr.vx || 1) * 8,
        phase: Math.random() * 6.28, spin: (Math.random() - 0.5) * 70, r: Math.random() * 360,
      })
    }

    return (dt, now) => {
      const t = now / 1000
      // How near the pointer is to the painting: 1 over it, fading out within 120 px of its edge.
      const ex = Math.max(box.ix - ptr.x, 0, ptr.x - (box.ix + box.iw))
      const ey = Math.max(box.iy - ptr.y, 0, ptr.y - (box.iy + box.ih))
      const near = Math.exp(-(ex * ex + ey * ey) / (120 * 120)) * ptr.lit
      const speed = Math.hypot(ptr.vx, ptr.vy)
      // The pointer's motion pushes the air; the push is capped so a fast flick is still a breeze.
      const cap = Math.min(1, 3.2 / Math.max(speed * 0.006, 1e-6))
      const tx = ptr.vx * 0.006 * cap * near
      const ty = ptr.vy * 0.006 * cap * near
      w.vx += (K * (tx - w.x) - C * w.vx) * dt
      w.vy += (K * (ty - w.y) - C * w.vy) * dt
      w.x += w.vx * dt
      w.y += w.vy * dt
      w.f += (Math.min(1, speed / 700) * near * 0.55 - w.f) * ease(dt, w.f < 0.3 ? 0.2 : 1.1)
      const k = ease(dt, 0.15)
      w.cx += (ptr.x - box.ix - w.cx) * (near > 0.01 ? k : 0)
      w.cy += (ptr.y - box.iy - w.cy) * (near > 0.01 ? k : 0)

      const energy = Math.hypot(w.x, w.y) + Math.hypot(w.vx, w.vy) * 0.05 + w.f
      if (energy > 0.003 || (view.stale && !w.still)) {
        view.stale = false
        view.show(Math.min(1, energy * 3))
        gl.uniform2f(u.u_p, w.cx, w.cy)
        gl.uniform2f(u.u_w, w.x, w.y)
        gl.uniform1f(u.u_f, w.f)
        gl.uniform1f(u.u_t, t % 1000)
        view.draw()
        w.still = false
      } else if (!w.still) {
        view.show(0)
        w.still = true
      }

      // A petal comes loose after the pointer has moved a good way through the blossoms, at most every few seconds.
      const over = near > 0.6 && ptr.x > box.ix && ptr.x < box.ix + box.iw && ptr.y > box.iy && ptr.y < box.iy + box.ih
      if (over) w.gust += speed * dt
      if (w.gust > 800 && now - w.lastPetal > 4000 && petals.length < 2) { w.gust = 0; loosen(now) }

      for (let i = petals.length - 1; i >= 0; i--) {
        const p = petals[i]
        const age = (now - p.born) / 1000
        if (age > 6.5) { p.el.remove(); petals.splice(i, 1); continue }
        p.vx *= Math.exp(-dt / 1.6)
        p.x += (p.vx + Math.sin(t * 1.7 + p.phase) * 16) * dt
        p.y += (22 + Math.min(age, 2) * 14 + Math.cos(t * 1.7 + p.phase) * 6) * dt
        p.r += p.spin * dt
        const flip = Math.cos(t * 2.1 + p.phase)
        const o = Math.min(1, age / 0.3) * (age > 4.2 ? Math.max(0, 1 - (age - 4.2) / 2.3) : 1)
        p.el.style.transform = `translate3d(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px, 0) rotate(${p.r.toFixed(1)}deg) scaleX(${(0.45 + 0.55 * Math.abs(flip)).toFixed(3)})`
        p.el.style.opacity = o.toFixed(3)
      }
    }
  }

  function start() {
    measure()
    const run = breeze()
    if (!run) return
    new ResizeObserver(() => { measure(); onResize?.() }).observe(art)
    const before = field.onFrame
    field.onFrame = (now) => {
      before?.(now)
      run(step(now), now)
    }
    field.tick()
  }
  const begin = () => img.decode().catch(() => {}).then(start)
  if (document.readyState === 'complete') begin()
  else addEventListener('load', begin, { once: true })
})()
