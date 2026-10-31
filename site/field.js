// The field: a slow drift of three soft colours over the paper, with a faint grain, drawn with WebGL at half
// resolution and at most 24 frames a second. It draws only while on screen and the tab is visible, holds one
// still frame under prefers-reduced-motion, and leaves the CSS gradient in place when WebGL is missing.
// A field can carry a lamp: a point the colours gather around and a light pools under, which the footer's
// scene moves with the pointer. While the lamp is lit the field draws every frame.
(() => {
  const VERT = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'
  const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_t;
uniform vec3 u_paper;
uniform vec3 u_a;
uniform vec3 u_b;
uniform vec3 u_c;
uniform float u_k;
uniform float u_light;
uniform float u_grain;
uniform vec2 u_lamp;
uniform float u_lit;
uniform vec3 u_glow;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float ar = u_res.x / u_res.y;
  vec2 q = vec2(uv.x * ar, uv.y);
  float t = u_t * 1.5;
  vec2 ca = vec2(ar * (0.22 + 0.16 * sin(t * 0.11)), 0.62 + 0.14 * cos(t * 0.09));
  vec2 cb = vec2(ar * (0.74 + 0.14 * cos(t * 0.07 + 1.7)), 0.36 + 0.16 * sin(t * 0.08 + 0.6));
  vec2 cc = vec2(ar * (0.52 + 0.2 * sin(t * 0.05 + 3.1)), 0.9 + 0.1 * cos(t * 0.06 + 2.2));
  ca = mix(ca, u_lamp, 0.26 * u_lit);
  cb = mix(cb, u_lamp, 0.26 * u_lit);
  cc = mix(cc, u_lamp, 0.18 * u_lit);
  vec2 d = q - u_lamp;
  float pool = exp(-dot(d, d) * 5.5) * u_lit;
  float k = u_k * (1.0 + 0.35 * pool);
  float fa = exp(-dot(q - ca, q - ca) * 2.0);
  float fb = exp(-dot(q - cb, q - cb) * 2.4);
  float fc = exp(-dot(q - cc, q - cc) * 2.8);
  vec3 col = u_paper;
  col = mix(col, u_a, fa * k);
  col = mix(col, u_b, fb * k);
  col = mix(col, u_c, fc * k * 0.85);
  col += u_light * sin((q.x * 0.8 + q.y * 1.3) * 3.14159 + t * 0.12);
  col += u_glow * pool;
  col += (hash(floor(gl_FragCoord.xy)) - 0.5) * u_grain;
  gl_FragColor = vec4(col, 1.0);
}`

  const hex = (s) => {
    const n = parseInt(s.trim().slice(1), 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }
  /** The mix strength and the light band per moment: the hero carries the most, the footer the least. */
  const STRENGTH = { hero: [0.5, 0.012], notify: [0.46, 0.01], footer: [0.4, 0.008] }
  /** The lamp's pool: a touch of warm light on paper, a warmer and brighter one at night. */
  const GLOW = { light: [0.085, 0.072, 0.05], dark: [0.12, 0.088, 0.05] }
  const UNIFORMS = ['u_res', 'u_t', 'u_paper', 'u_a', 'u_b', 'u_c', 'u_k', 'u_light', 'u_grain', 'u_lamp', 'u_lit', 'u_glow']

  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const fields = []

  class Field {
    constructor(root) {
      this.root = root
      this.kind = root.dataset.field
      this.canvas = root.querySelector('canvas')
      this.ok = false
      this.visible = false
      this.raf = 0
      this.last = 0
      this.lamp = [0.5, 0.5]
      this.lit = 0
      /** A scene that rides this field's loop: called every animation frame while running, before the draw. */
      this.onFrame = null
      this.width = 1
      this.height = 1
      this.start = performance.now() + Math.random() * 60000
      this.setup()
      new ResizeObserver(() => { this.resize(); this.frame(true) }).observe(root)
      new IntersectionObserver((entries) => { this.visible = entries.some((e) => e.isIntersecting); this.tick() }, { rootMargin: '80px' }).observe(root)
    }
    setup() {
      const gl = this.canvas.getContext('webgl', { antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'low-power' })
      if (!gl) return
      const program = gl.createProgram()
      for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
        const shader = gl.createShader(type)
        gl.shaderSource(shader, src)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return
        gl.attachShader(program, shader)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
      gl.useProgram(program)
      const buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const p = gl.getAttribLocation(program, 'p')
      gl.enableVertexAttribArray(p)
      gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0)
      this.gl = gl
      this.u = {}
      for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(program, name)
      this.ok = true
      this.colours()
      this.resize()
      this.root.classList.add('live')
    }
    colours() {
      const css = getComputedStyle(this.root)
      const gl = this.gl
      gl.uniform3fv(this.u.u_paper, hex(css.getPropertyValue('--paper')))
      gl.uniform3fv(this.u.u_a, hex(css.getPropertyValue('--field-a')))
      gl.uniform3fv(this.u.u_b, hex(css.getPropertyValue('--field-b')))
      gl.uniform3fv(this.u.u_c, hex(css.getPropertyValue('--field-c')))
      const dark = css.colorScheme === 'dark'
      const [k, light] = STRENGTH[this.kind] ?? STRENGTH.footer
      gl.uniform1f(this.u.u_k, k)
      gl.uniform1f(this.u.u_light, light)
      gl.uniform1f(this.u.u_grain, dark ? 0.028 : 0.022)
      gl.uniform3fv(this.u.u_glow, GLOW[dark ? 'dark' : 'light'])
    }
    resize() {
      this.width = this.root.clientWidth || 1
      this.height = this.root.clientHeight || 1
      if (!this.ok) return
      const scale = Math.min(devicePixelRatio || 1, 2) * 0.5
      const w = Math.max(1, Math.round(this.width * scale))
      const h = Math.max(1, Math.round(this.height * scale))
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w
        this.canvas.height = h
        this.gl.viewport(0, 0, w, h)
        this.gl.uniform2f(this.u.u_res, w, h)
      }
    }
    /** Where the lamp is, in CSS pixels from the field's top left, and how lit it is, 0 to 1. */
    setLamp(x, y, lit) {
      const ar = this.width / this.height
      this.lamp[0] = (x / this.width) * ar
      this.lamp[1] = 1 - y / this.height
      this.lit = lit
    }
    /** One frame at the current moment. `still` draws even when paused, for a resize or a theme change. */
    frame(still) {
      if (!this.ok) return
      const now = performance.now()
      const gap = this.lit > 0.01 ? 0 : 1000 / 24
      if (!still && now - this.last < gap) return
      this.last = now
      const gl = this.gl
      gl.uniform1f(this.u.u_t, (now - this.start) / 1000)
      gl.uniform2f(this.u.u_lamp, this.lamp[0], this.lamp[1])
      gl.uniform1f(this.u.u_lit, this.lit)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    get running() { return (this.ok || this.onFrame) && this.visible && !document.hidden && !reduced.matches }
    tick() {
      cancelAnimationFrame(this.raf)
      if (!this.running) { this.frame(true); return }
      const loop = (now) => {
        if (!this.running) return
        this.onFrame?.(now)
        this.frame(false)
        this.raf = requestAnimationFrame(loop)
      }
      this.raf = requestAnimationFrame(loop)
    }
    retheme() { if (!this.ok) return; this.colours(); this.frame(true) }
  }

  for (const root of document.querySelectorAll('.field')) fields.push(new Field(root))
  document.addEventListener('visibilitychange', () => fields.forEach((f) => f.tick()))
  reduced.addEventListener('change', () => fields.forEach((f) => f.tick()))
  window.junoFields = { retheme: () => fields.forEach((f) => f.retheme()), get: (kind) => fields.find((f) => f.kind === kind) }
})()
