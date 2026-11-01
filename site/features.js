// The features section. One feature is always chosen. A feature with a spot lights up where it lives in the window;
// a feature with a state swaps the window for the same window in that state, with a short cross-fade.
//
// When the section comes into view, a tour moves through the features. The chosen label's fill runs a progress bar
// (a CSS animation), and the bar's end moves the tour on, so there is no timer to keep in step. The tour pauses
// while the section is off screen or the tab is hidden, and stops for good at the first hover, focus or tap on a
// label; from then on the pointer chooses. Under reduced motion there is no tour and the first feature stays chosen.
(() => {
  const section = document.querySelector('.features')
  if (!section) return
  const frame = section.querySelector('.window')
  const spot = section.querySelector('.spot')
  const layers = section.querySelector('.states')
  const caption = section.querySelector('.feature-caption')
  const buttons = [...section.querySelectorAll('.feature')]
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const systemDark = matchMedia('(prefers-color-scheme: dark)')
  const theme = () => (document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light'))

  // One image per state and theme, made on first need. A state shows only once its image has loaded, so a change
  // never flashes an empty window; until then the window before it stays.
  const images = new Map()
  function image(name, t = theme()) {
    const key = `${name}-${t}`
    let img = images.get(key)
    if (!img) {
      img = new Image()
      img.alt = ''
      img.decoding = 'async'
      img.src = `/img/state-${key}.webp`
      img.ready = img.decode().catch(() => {})
      layers.append(img)
      images.set(key, img)
    }
    return img
  }

  // Loads the current theme's states one after another, in tour order, once the section is near.
  let warming = false
  async function warm() {
    if (warming) return
    warming = true
    const t = theme()
    for (const b of buttons) if (b.dataset.state) await image(b.dataset.state, t).ready
    warming = false
  }

  let chosen = null
  let showing = 0
  let depth = 0
  async function choose(button) {
    if (chosen === button) return
    chosen = button
    for (const b of buttons) b.setAttribute('aria-pressed', String(b === button))
    caption.textContent = button.querySelector('.sr').textContent.trim()
    const ticket = ++showing
    const name = button.dataset.state
    if (!name) {
      const [x, y, w, h] = button.dataset.spot.split(' ')
      spot.style.setProperty('--x', x)
      spot.style.setProperty('--y', y)
      spot.style.setProperty('--w', w)
      spot.style.setProperty('--h', h)
      frame.classList.add('lit')
      for (const img of images.values()) {
        img.style.transition = ''
        img.classList.remove('on')
      }
      return
    }
    const img = image(name)
    await img.ready
    // Decode again: a browser may drop a hidden image's pixels, and a new state must never fade in blank.
    await img.decode().catch(() => {})
    if (ticket !== showing) return
    frame.classList.remove('lit')
    // The new state fades in on top while the one before stays fully opaque under it, so the change never dips
    // through to the window behind. Once it has faded in, the states under it go at once.
    img.style.transition = ''
    img.style.zIndex = String(++depth)
    img.classList.add('on')
    setTimeout(() => {
      if (ticket !== showing) return
      for (const other of images.values()) {
        if (other === img || !other.classList.contains('on')) continue
        other.style.transition = 'none'
        other.classList.remove('on')
      }
    }, 260)
  }

  // A theme change shows the chosen state in the new theme and loads that theme's states.
  function retheme() {
    const button = chosen
    chosen = null
    if (button) choose(button)
    if (near) warm()
  }
  systemDark.addEventListener('change', retheme)
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  // The tour.
  let touring = !reduced
  let near = false
  let seen = false
  const list = section.querySelector('.feature-list')
  function pause() {
    list.classList.toggle('paused', !seen || document.hidden)
  }
  function stop() {
    if (!touring) return
    touring = false
    list.classList.remove('touring', 'paused')
  }
  list.addEventListener('animationend', (e) => {
    if (!touring || e.target !== chosen) return
    choose(buttons[(buttons.indexOf(chosen) + 1) % buttons.length])
  })
  document.addEventListener('visibilitychange', pause)

  new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting || near) return
    near = true
    warm()
  }, { rootMargin: '800px 0px' }).observe(section)

  new IntersectionObserver(([entry]) => {
    seen = entry.isIntersecting
    if (seen && touring) list.classList.add('touring')
    pause()
  }, { threshold: 0.35 }).observe(frame)

  // A touch chooses on release; mouse and pen on hover; the keyboard on focus. Any of them ends the tour.
  for (const button of buttons) {
    button.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return
      stop()
      choose(button)
    })
    button.addEventListener('pointerdown', stop)
    button.addEventListener('focus', () => {
      stop()
      choose(button)
    })
    button.addEventListener('click', () => {
      stop()
      choose(button)
    })
  }

  choose(buttons[0])
})()
